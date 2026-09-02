'use strict';

/**
 * Data access for GoalsHQ. Every query is scoped by user_id; core rows (Goal,
 * Project) are looked up through tududi's models via the compat shim — no
 * Sequelize associations, no include (see ADR-0001).
 */

const t = require('./core/tududi');
const {
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('./models');

const { Op, Goal, Project } = t;
const { Area } = require('../../models');

/* ------------------------------------------------------------- core lookups */

async function goalByUid(userId, uid) {
    return Goal.findOne({ where: { uid, user_id: userId } });
}

async function goalById(userId, id) {
    return Goal.findOne({ where: { id, user_id: userId } });
}

async function projectByUid(userId, uid) {
    return Project.findOne({ where: { uid, user_id: userId } });
}

async function goalsForUser(userId) {
    return Goal.findAll({
        where: { user_id: userId },
        include: [{ model: Area, attributes: ['uid', 'name', 'color'] }],
        order: [['title', 'ASC']],
    });
}

/* --------------------------------------------------------------- settings */

async function findOrCreateSettings(goalId, userId) {
    const [settings] = await GoalshqGoalSettings.findOrCreate({
        where: { goal_id: goalId },
        defaults: { goal_id: goalId, user_id: userId },
    });
    return settings;
}

async function settingsByGoalIds(goalIds) {
    if (goalIds.length === 0) return new Map();
    const rows = await GoalshqGoalSettings.findAll({
        where: { goal_id: { [Op.in]: goalIds } },
    });
    return new Map(rows.map((r) => [r.goal_id, r]));
}

/* -------------------------------------------------------------- strategies */

async function strategiesByGoalId(userId, goalId) {
    return GoalshqStrategy.findAll({
        where: { goal_id: goalId, user_id: userId },
        order: [
            ['sort_order', 'ASC'],
            ['id', 'ASC'],
        ],
    });
}

async function strategiesByGoalIds(userId, goalIds) {
    if (goalIds.length === 0) return new Map();
    const rows = await GoalshqStrategy.findAll({
        where: { goal_id: { [Op.in]: goalIds }, user_id: userId },
        order: [
            ['sort_order', 'ASC'],
            ['id', 'ASC'],
        ],
    });
    const map = new Map();
    for (const s of rows) {
        const list = map.get(s.goal_id) || [];
        list.push(s);
        map.set(s.goal_id, list);
    }
    return map;
}

async function strategyByUid(userId, uid) {
    return GoalshqStrategy.findOne({ where: { uid, user_id: userId } });
}

async function createStrategy(data) {
    return GoalshqStrategy.create(data);
}

async function maxStrategySortOrder(goalId) {
    const row = await GoalshqStrategy.findOne({
        where: { goal_id: goalId },
        order: [['sort_order', 'DESC']],
        attributes: ['sort_order'],
    });
    return row ? row.sort_order : -1;
}

/* ------------------------------------------------------- project ↔ strategy */

async function linkProjectToStrategy(strategyId, projectId, userId, weight) {
    const existing = await GoalshqProjectStrategy.findOne({
        where: { project_id: projectId },
    });
    if (existing) {
        return existing.update({
            strategy_id: strategyId,
            user_id: userId,
            weight: weight ?? existing.weight,
        });
    }
    return GoalshqProjectStrategy.create({
        strategy_id: strategyId,
        project_id: projectId,
        user_id: userId,
        weight: weight ?? 1,
    });
}

async function unlinkProject(strategyId, projectId) {
    return GoalshqProjectStrategy.destroy({
        where: { strategy_id: strategyId, project_id: projectId },
    });
}

async function linksForStrategy(strategyId) {
    return GoalshqProjectStrategy.findAll({
        where: { strategy_id: strategyId },
    });
}

async function linkedProjectIdsForGoal(userId, goalId) {
    const strategies = await GoalshqStrategy.findAll({
        where: { goal_id: goalId, user_id: userId },
        attributes: ['id'],
    });
    if (strategies.length === 0) return [];
    const links = await GoalshqProjectStrategy.findAll({
        where: { strategy_id: { [Op.in]: strategies.map((s) => s.id) } },
        attributes: ['project_id'],
    });
    return links.map((l) => l.project_id);
}

/* ----------------------------------------------------- key results / milestones */

function krWhere(parentType, parentId) {
    return { parent_type: parentType, parent_id: parentId };
}

async function keyResults(parentType, parentId) {
    return GoalshqKeyResult.findAll({
        where: krWhere(parentType, parentId),
        order: [['sort_order', 'ASC']],
    });
}

async function keyResultByUid(userId, uid) {
    return GoalshqKeyResult.findOne({ where: { uid, user_id: userId } });
}

async function createKeyResult(data) {
    return GoalshqKeyResult.create(data);
}

async function milestones(parentType, parentId) {
    return GoalshqMilestone.findAll({
        where: krWhere(parentType, parentId),
        order: [['sort_order', 'ASC']],
    });
}

async function milestoneByUid(userId, uid) {
    return GoalshqMilestone.findOne({ where: { uid, user_id: userId } });
}

async function createMilestone(data) {
    return GoalshqMilestone.create(data);
}

/* ------------------------------------------------------------- snapshots */

async function snapshots(parentType, parentId, { from, to, limit } = {}) {
    const where = { parent_type: parentType, parent_id: parentId };
    if (from || to) {
        where.snapshot_date = {};
        if (from) where.snapshot_date[Op.gte] = from;
        if (to) where.snapshot_date[Op.lte] = to;
    }
    return GoalshqProgressSnapshot.findAll({
        where,
        order: [['snapshot_date', 'ASC']],
        limit: limit || 90,
    });
}

/* ---------------------------------------------------------- task breakdown */

/** done / total top-level task counts for a set of project ids, grouped. */
async function taskCountsByProject(projectIds) {
    if (projectIds.length === 0) return new Map();
    const { fn, col, Task } = t;
    const rows = await Task.findAll({
        where: { project_id: { [Op.in]: projectIds }, parent_task_id: null },
        attributes: ['project_id', 'status', [fn('COUNT', col('id')), 'count']],
        group: ['project_id', 'status'],
        raw: true,
    });
    const map = new Map();
    for (const row of rows) {
        const status = Number(row.status);
        if (t.EXCLUDED_STATUSES.includes(status)) continue;
        const entry = map.get(row.project_id) || { done: 0, total: 0 };
        const count = Number(row.count) || 0;
        entry.total += count;
        if (t.DONE_STATUSES.includes(status)) entry.done += count;
        map.set(row.project_id, entry);
    }
    return map;
}

async function projectsForGoal(userId, goalId) {
    return Project.findAll({
        where: { goal_id: goalId, user_id: userId },
        attributes: ['id', 'uid', 'name', 'status', 'priority', 'color'],
    });
}

async function projectsByIds(userId, ids) {
    if (ids.length === 0) return [];
    return Project.findAll({
        where: { id: { [Op.in]: ids }, user_id: userId },
        attributes: ['id', 'uid', 'name', 'status', 'priority', 'color'],
    });
}

module.exports = {
    goalByUid,
    goalById,
    projectByUid,
    goalsForUser,
    findOrCreateSettings,
    settingsByGoalIds,
    strategiesByGoalId,
    strategiesByGoalIds,
    strategyByUid,
    createStrategy,
    maxStrategySortOrder,
    linkProjectToStrategy,
    unlinkProject,
    linksForStrategy,
    linkedProjectIdsForGoal,
    keyResults,
    keyResultByUid,
    createKeyResult,
    milestones,
    milestoneByUid,
    createMilestone,
    snapshots,
    taskCountsByProject,
    projectsForGoal,
    projectsByIds,
};
