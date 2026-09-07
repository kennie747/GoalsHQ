'use strict';

/**
 * Carryover/rescheduling (Phase D). Classifies yesterday's-and-earlier
 * unfinished work into resurface/reschedule/drop instead of letting it
 * accumulate silently as ever-growing "overdue" noise.
 *
 * v1 never writes to a task's due_date/status automatically — classification
 * only ever creates a review-queue row; the task itself is only touched when
 * the user explicitly accepts or overrides that row (see accept()/override()
 * below). "resurface" never touches the task at all, even on accept — it's
 * purely informational (this task matters, don't lose it, but nothing to
 * change about it).
 */

const { Op } = require('sequelize');
const {
    Task,
    User,
    Project,
    TaskCarryoverEvent,
    GoalshqProjectStrategy,
    GoalshqStrategy,
    GoalshqGoalSettings,
} = require('../../../models');
const logService = require('../../../services/logService');
const {
    getSafeTimezone,
    getCurrentDateInTimezone,
    getTodayBoundsInUTC,
} = require('../../../utils/timezone-utils');
const errors = require('../../../shared/errors');

const { NotFoundError, ValidationError } = errors;

const EXCLUDED_STATUSES = [
    Task.STATUS.DONE,
    Task.STATUS.ARCHIVED,
    Task.STATUS.CANCELLED,
];
const AT_RISK_HEALTH = ['at_risk', 'off_track'];
const CLASSIFICATIONS = ['resurface', 'reschedule', 'drop'];

const DROP_THRESHOLD_DAYS = parseInt(
    process.env.CARRYOVER_DROP_THRESHOLD_DAYS || '14',
    10
);

/* ------------------------------------------------------------- classify */

/**
 * Batched: for every currently-overdue task across all users that doesn't
 * already have a pending (unreviewed) carryover event, resolve whether it's
 * linked to a Strategy/Goal, whether that Strategy/Goal is at_risk/off_track,
 * and create exactly one new event per task. Never touches the task itself.
 *
 * Safe to call repeatedly (idempotent): a task with an existing pending event
 * is skipped until that event is reviewed.
 */
async function classifyOverdueTasks() {
    const pendingTaskIds = (
        await TaskCarryoverEvent.findAll({
            where: { reviewed_at: null },
            attributes: ['task_id'],
            raw: true,
        })
    ).map((r) => r.task_id);

    const candidates = await Task.findAll({
        where: {
            status: { [Op.notIn]: EXCLUDED_STATUSES },
            due_date: { [Op.ne]: null },
            parent_task_id: null,
            ...(pendingTaskIds.length
                ? { id: { [Op.notIn]: pendingTaskIds } }
                : {}),
        },
        include: [{ model: User, attributes: ['id', 'timezone'] }],
    });

    if (candidates.length === 0) return { classified: 0 };

    const overdueNow = candidates.filter((task) => {
        const tz = getSafeTimezone(task.User && task.User.timezone);
        const todayStart = getTodayBoundsInUTC(tz).start;
        return new Date(task.due_date) < todayStart;
    });

    if (overdueNow.length === 0) return { classified: 0 };

    // --- batch-resolve strategy/goal linkage, never a per-task query -----
    const projectIds = [
        ...new Set(
            overdueNow.filter((t) => t.project_id).map((t) => t.project_id)
        ),
    ];
    const directGoalIds = [
        ...new Set(
            overdueNow
                .filter((t) => !t.project_id && t.goal_id)
                .map((t) => t.goal_id)
        ),
    ];

    const projects = projectIds.length
        ? await Project.findAll({
              where: { id: { [Op.in]: projectIds } },
              attributes: ['id', 'goal_id'],
          })
        : [];
    const goalIdByProject = new Map(projects.map((p) => [p.id, p.goal_id]));

    const links = projectIds.length
        ? await GoalshqProjectStrategy.findAll({
              where: { project_id: { [Op.in]: projectIds } },
          })
        : [];
    const strategyIdsByProject = new Map();
    for (const link of links) {
        const list = strategyIdsByProject.get(link.project_id) || [];
        list.push(link.strategy_id);
        strategyIdsByProject.set(link.project_id, list);
    }

    const allGoalIds = [
        ...new Set(
            [...projects.map((p) => p.goal_id), ...directGoalIds].filter(
                Boolean
            )
        ),
    ];
    const goalSettings = allGoalIds.length
        ? await GoalshqGoalSettings.findAll({
              where: { goal_id: { [Op.in]: allGoalIds } },
          })
        : [];
    const healthByGoalId = new Map(
        goalSettings.map((s) => [s.goal_id, s.cached_health])
    );

    const allStrategyIds = [...new Set(links.map((l) => l.strategy_id))];
    const strategies = allStrategyIds.length
        ? await GoalshqStrategy.findAll({
              where: { id: { [Op.in]: allStrategyIds } },
          })
        : [];
    const healthByStrategyId = new Map(
        strategies.map((s) => [s.id, s.cached_health])
    );

    function isLinked(task) {
        return !!(task.project_id || task.goal_id);
    }

    function isStrategicallyAtRisk(task) {
        if (task.project_id) {
            const strategyIds = strategyIdsByProject.get(task.project_id) || [];
            if (
                strategyIds.some((sid) =>
                    AT_RISK_HEALTH.includes(healthByStrategyId.get(sid))
                )
            ) {
                return true;
            }
            const goalId = goalIdByProject.get(task.project_id);
            return goalId
                ? AT_RISK_HEALTH.includes(healthByGoalId.get(goalId))
                : false;
        }
        if (task.goal_id) {
            return AT_RISK_HEALTH.includes(healthByGoalId.get(task.goal_id));
        }
        return false;
    }

    // --- classify + build rows, one bulkCreate, never a per-task insert ---
    const rows = overdueNow.map((task) => {
        const tz = getSafeTimezone(task.User && task.User.timezone);
        const today = getCurrentDateInTimezone(tz);
        const linked = isLinked(task);
        const highPriority = task.priority === Task.PRIORITY.HIGH;
        const previousDueDate = new Date(task.due_date)
            .toISOString()
            .split('T')[0];

        let classification;
        let newDueDate = null;

        if (linked && (isStrategicallyAtRisk(task) || highPriority)) {
            classification = 'resurface';
        } else if (linked) {
            classification = 'reschedule';
            newDueDate = today;
        } else {
            const daysOverdue = Math.floor(
                (Date.parse(today) - Date.parse(previousDueDate)) / 86_400_000
            );
            if (daysOverdue >= DROP_THRESHOLD_DAYS && !highPriority) {
                classification = 'drop';
            } else {
                classification = 'reschedule';
                newDueDate = today;
            }
        }

        return {
            task_id: task.id,
            user_id: task.user_id,
            occurred_on: today,
            classification,
            previous_due_date: previousDueDate,
            new_due_date: newDueDate,
            source: 'auto',
            reviewed_at: null,
        };
    });

    await TaskCarryoverEvent.bulkCreate(rows);
    logService.logInfo(`[carryover] classified ${rows.length} task(s)`);
    return { classified: rows.length };
}

/* ------------------------------------------------------------ review queue */

async function listPending(userId) {
    const events = await TaskCarryoverEvent.findAll({
        where: { user_id: userId, reviewed_at: null },
        include: [{ model: Task, as: 'Task' }],
        order: [['occurred_on', 'DESC']],
    });
    // A task can be completed/deleted between classification and review —
    // skip anything whose task is gone rather than surfacing a dangling row.
    return events.filter((e) => e.Task);
}

const HISTORY_LIMIT = 200;

/**
 * Read-only history — every carryover event ever classified for this user,
 * reviewed or not (Phase F archive view). Unlike listPending(), a dangling
 * task (deleted since classification) is still shown — task_name/task_uid
 * come back null via the serializer rather than being silently dropped,
 * since this is a historical record, not an actionable queue.
 */
async function listHistory(userId, limit = HISTORY_LIMIT) {
    return TaskCarryoverEvent.findAll({
        where: { user_id: userId },
        include: [{ model: Task, as: 'Task', required: false }],
        order: [['occurred_on', 'DESC']],
        limit,
    });
}

async function findOwnedEvent(userId, id) {
    const event = await TaskCarryoverEvent.findOne({
        where: { id, user_id: userId },
        include: [{ model: Task, as: 'Task' }],
    });
    if (!event) throw new NotFoundError('Carryover event not found');
    return event;
}

/** Apply a (possibly just-overridden) classification's effect to the task. */
async function applyEffect(event) {
    if (!event.Task) return;
    if (event.classification === 'reschedule' && event.new_due_date) {
        await event.Task.update({ due_date: event.new_due_date });
    } else if (event.classification === 'drop') {
        await event.Task.update({ status: Task.STATUS.CANCELLED });
    }
    // 'resurface' never touches the task.
}

async function accept(userId, id) {
    const event = await findOwnedEvent(userId, id);
    if (event.reviewed_at) {
        throw new ValidationError('This carryover event was already reviewed');
    }
    await applyEffect(event);
    await event.update({ reviewed_at: new Date() });
    return event;
}

async function override(userId, id, body) {
    const event = await findOwnedEvent(userId, id);
    if (event.reviewed_at) {
        throw new ValidationError('This carryover event was already reviewed');
    }
    if (!CLASSIFICATIONS.includes(body.classification)) {
        throw new ValidationError(
            `classification must be one of: ${CLASSIFICATIONS.join(', ')}`
        );
    }
    const updates = {
        classification: body.classification,
        source: 'user_override',
    };
    if (body.classification === 'reschedule') {
        if (!body.new_due_date) {
            throw new ValidationError(
                'new_due_date is required when overriding to "reschedule"'
            );
        }
        updates.new_due_date = body.new_due_date;
    } else {
        updates.new_due_date = null;
    }
    await event.update(updates);
    await applyEffect(event);
    await event.update({ reviewed_at: new Date() });
    return event;
}

module.exports = {
    classifyOverdueTasks,
    listPending,
    listHistory,
    accept,
    override,
};
