'use strict';

const { sequelize, Task, GoalshqStrategy } = require('../../models');
const errors = require('../../shared/errors');
const repo = require('./repository');
const rollup = require('./operations/rollup');
const math = require('./operations/progress-math');
const v = require('./validation');
const s = require('./core/serializers');

const { NotFoundError, ValidationError } = errors;

const STALE_MINUTES = parseInt(process.env.GOALSHQ_STALE_MINUTES || '20', 10);

function isEnabled() {
    return process.env.GOALSHQ_ENABLED !== 'false';
}

/* --------------------------------------------------------------- goal list */

async function listGoals(userId, { recompute = true } = {}) {
    const goals = await repo.goalsForUser(userId);
    const goalIds = goals.map((g) => g.id);

    if (recompute) {
        const settingsMap = await repo.settingsByGoalIds(goalIds);
        const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
        for (const g of goals) {
            const st = settingsMap.get(g.id);
            if (
                !st ||
                !st.cached_computed_at ||
                st.cached_computed_at < cutoff
            ) {
                // eslint-disable-next-line no-await-in-loop
                await rollup.recomputeGoal(g.id, { source: 'on_read' });
            }
        }
    }

    const [settingsMap, strategyMap] = await Promise.all([
        repo.settingsByGoalIds(goalIds),
        repo.strategiesByGoalIds(userId, goalIds),
    ]);

    // Batch-resolve which projects (by uid) each strategy is linked to, so the
    // frontend can attribute a task to its Strategy (not just its Goal) without
    // an extra round trip per strategy. One query for the links, one for the
    // project uids — never a per-strategy loop.
    const allStrategyIds = [...strategyMap.values()]
        .flat()
        .map((strat) => strat.id);
    const linksByStrategy = await repo.linksForStrategies(allStrategyIds);
    const allLinkedProjectIds = [
        ...new Set([...linksByStrategy.values()].flat()),
    ];
    const linkedProjects = await repo.projectsByIds(
        userId,
        allLinkedProjectIds
    );
    const projectUidById = new Map(linkedProjects.map((p) => [p.id, p.uid]));
    const projectRefById = new Map(
        linkedProjects.map((p) => [p.id, { uid: p.uid, name: p.name }])
    );
    const projectUidsByStrategy = new Map(
        [...linksByStrategy.entries()].map(([strategyId, projectIds]) => [
            strategyId,
            projectIds.map((pid) => projectUidById.get(pid)).filter(Boolean),
        ])
    );
    const projectsByStrategy = new Map(
        [...linksByStrategy.entries()].map(([strategyId, projectIds]) => [
            strategyId,
            projectIds.map((pid) => projectRefById.get(pid)).filter(Boolean),
        ])
    );

    // Stats-footer counts (Strategy overview cards): projects/tasks associated
    // with a goal either directly (goal_id FK) or through any of its
    // strategies' project links — deduped, since Phase A's many-to-many means
    // a project can reach a goal both ways. Tasks include subtasks, matching
    // taskCountsByProject's existing (Phase A Follow-up AF1) convention.
    const strategyIdsByGoal = new Map(
        [...strategyMap.entries()].map(([goalId, strats]) => [
            goalId,
            strats.map((strat) => strat.id),
        ])
    );
    const directProjects = await repo.projectsForGoalIds(userId, goalIds);
    const directProjectIdsByGoal = new Map();
    for (const p of directProjects) {
        const list = directProjectIdsByGoal.get(p.goal_id) || [];
        list.push(p.id);
        directProjectIdsByGoal.set(p.goal_id, list);
    }
    const projectIdsByGoal = new Map();
    for (const goalId of goalIds) {
        const ids = new Set(directProjectIdsByGoal.get(goalId) || []);
        for (const stratId of strategyIdsByGoal.get(goalId) || []) {
            for (const pid of linksByStrategy.get(stratId) || []) ids.add(pid);
        }
        projectIdsByGoal.set(goalId, ids);
    }
    const allAssociatedProjectIds = [
        ...new Set([...projectIdsByGoal.values()].flatMap((set) => [...set])),
    ];
    const [directTaskCountsByGoal, taskCountsByProject] = await Promise.all([
        repo.taskCountsByGoalIds(goalIds),
        repo.taskCountsByProject(allAssociatedProjectIds),
    ]);
    const projectsCountByGoal = new Map();
    const tasksCountByGoal = new Map();
    for (const goalId of goalIds) {
        const projectIds = projectIdsByGoal.get(goalId) || new Set();
        projectsCountByGoal.set(goalId, projectIds.size);
        let tasks = directTaskCountsByGoal.get(goalId) || 0;
        for (const pid of projectIds) {
            tasks += taskCountsByProject.get(pid)?.total || 0;
        }
        tasksCountByGoal.set(goalId, tasks);
    }

    return goals
        .map((g) =>
            s.serializeGoalSummary(
                g,
                settingsMap.get(g.id),
                strategyMap.get(g.id) || [],
                {
                    projectUidsByStrategy,
                    projectsByStrategy,
                    projectsCount: projectsCountByGoal.get(g.id) ?? 0,
                    tasksCount: tasksCountByGoal.get(g.id) ?? 0,
                }
            )
        )
        .sort(byRiskThenTitle);
}

function healthRank(h) {
    return { off_track: 0, at_risk: 1, no_data: 2, on_track: 3 }[h] ?? 2;
}

function byRiskThenTitle(a, b) {
    const r = healthRank(a.execution_health) - healthRank(b.execution_health);
    if (r !== 0) return r;
    return (a.title || '').localeCompare(b.title || '');
}

/* ------------------------------------------------------------- goal detail */

async function getGoalDetail(userId, uid, { recompute = true } = {}) {
    const goal = await repo.goalByUid(userId, uid);
    if (!goal) throw new NotFoundError('Goal not found');

    if (recompute) {
        await rollup.recomputeGoal(goal.id, { source: 'on_read' });
    }

    const [settings, strategies, keyResults, milestones, snaps] =
        await Promise.all([
            repo.findOrCreateSettings(goal.id, userId),
            repo.strategiesByGoalId(userId, goal.id),
            repo.keyResults('goal', goal.id),
            repo.milestones('goal', goal.id),
            repo.snapshots('goal', goal.id, { limit: 180 }),
        ]);

    // Every project on this goal (strategy grouping doesn't change the number).
    const goalProjects = await repo.projectsForGoal(userId, goal.id);
    const projectCounts = await repo.taskCountsByProject(
        goalProjects.map((p) => p.id)
    );
    const projectSettings = await repo.projectSettingsByIds(
        goalProjects.map((p) => p.id)
    );

    const strategyOut = await Promise.all(
        strategies.map((strat) => hydrateStrategy(userId, strat))
    );

    return {
        uid: goal.uid,
        title: goal.title,
        why: goal.why,
        status: goal.status,
        horizon: goal.horizon,
        target_date: goal.target_date,
        color: goal.color,
        settings: s.serializeSettings(settings),
        execution_percent: num(settings.cached_execution_percent),
        execution_health: settings.cached_execution_health || 'no_data',
        outcome_percent: settings.metrics_enabled
            ? num(settings.cached_outcome_percent)
            : null,
        outcome_health: settings.metrics_enabled
            ? settings.cached_outcome_health || 'no_data'
            : 'no_data',
        strategies: strategyOut,
        key_results: keyResults.map(s.serializeKeyResult),
        milestones: milestones.map(s.serializeMilestone),
        projects: goalProjects.map((p) => {
            const st = projectSettings.get(p.id);
            return {
                ...s.serializeProjectRef(
                    p,
                    st && st.cached_execution_percent != null
                        ? Number(st.cached_execution_percent)
                        : percentOf(projectCounts.get(p.id))
                ),
                metrics_enabled: !!(st && st.metrics_enabled),
                outcome_percent:
                    st && st.metrics_enabled
                        ? num(st.cached_outcome_percent)
                        : null,
            };
        }),
        trend: snaps.map(s.serializeSnapshot),
    };
}

function num(x) {
    return x == null ? null : Number(x);
}

function percentOf(counts) {
    if (!counts || counts.total <= 0) return null;
    return math.round1((counts.done / counts.total) * 100);
}

/* ----------------------------------------------------------- goal settings */

async function updateGoalSettings(userId, uid, body) {
    const goal = await repo.goalByUid(userId, uid);
    if (!goal) throw new NotFoundError('Goal not found');
    const settings = await repo.findOrCreateSettings(goal.id, userId);

    v.assertBoolean(body.metrics_enabled, 'metrics_enabled');
    v.assertDate(body.start_date, 'start_date');
    v.assertPercent(body.manual_percent, 'manual_percent');

    const updates = {};
    if (body.metrics_enabled !== undefined)
        updates.metrics_enabled = !!body.metrics_enabled;
    if (body.start_date !== undefined)
        updates.start_date = body.start_date || null;
    if (body.manual_percent !== undefined)
        updates.manual_percent =
            body.manual_percent === null ? null : Number(body.manual_percent);

    await settings.update(updates);
    await rollup.recomputeGoal(goal.id, { source: 'manual' });
    return s.serializeSettings(
        await repo.findOrCreateSettings(goal.id, userId)
    );
}

/* --------------------------------------------------------- project settings */

async function getProjectDetail(userId, uid) {
    const project = await repo.projectByUid(userId, uid);
    if (!project) throw new NotFoundError('Project not found');
    if (project.goal_id) {
        await rollup.recomputeGoal(project.goal_id, { source: 'on_read' });
    } else {
        await rollup.recomputeProject(project.id, { source: 'on_read' });
    }
    const [settings, keyResults, milestones, snaps] = await Promise.all([
        repo.findOrCreateProjectSettings(project.id, userId),
        repo.keyResults('project', project.id),
        repo.milestones('project', project.id),
        repo.snapshots('project', project.id, { limit: 180 }),
    ]);
    return {
        uid: project.uid,
        name: project.name,
        status: project.status,
        settings: s.serializeSettings(settings),
        execution_percent: num(settings.cached_execution_percent),
        execution_health: settings.cached_execution_health || 'no_data',
        outcome_percent: settings.metrics_enabled
            ? num(settings.cached_outcome_percent)
            : null,
        outcome_health: settings.metrics_enabled
            ? settings.cached_outcome_health || 'no_data'
            : 'no_data',
        key_results: keyResults.map(s.serializeKeyResult),
        milestones: milestones.map(s.serializeMilestone),
        trend: snaps.map(s.serializeSnapshot),
    };
}

async function updateProjectSettings(userId, uid, body) {
    const project = await repo.projectByUid(userId, uid);
    if (!project) throw new NotFoundError('Project not found');
    const settings = await repo.findOrCreateProjectSettings(project.id, userId);

    v.assertBoolean(body.metrics_enabled, 'metrics_enabled');
    v.assertPercent(body.manual_percent, 'manual_percent');

    const updates = {};
    if (body.metrics_enabled !== undefined)
        updates.metrics_enabled = !!body.metrics_enabled;
    if (body.manual_percent !== undefined)
        updates.manual_percent =
            body.manual_percent === null ? null : Number(body.manual_percent);

    await settings.update(updates);
    await recomputeForProject(project);
    return s.serializeSettings(
        await repo.findOrCreateProjectSettings(project.id, userId)
    );
}

/* -------------------------------------------------------------- strategies */

/** Recompute whichever entity owns a strategy's number (its goal, or itself). */
async function recomputeForStrategy(strategy, extraGoalIds = []) {
    const goalIds = new Set(
        [strategy.goal_id, ...extraGoalIds].filter((id) => id != null)
    );
    for (const gid of goalIds) {
        // eslint-disable-next-line no-await-in-loop
        await rollup.recomputeGoal(gid, { source: 'manual' });
    }
    if (strategy.goal_id == null) {
        await rollup.recomputeStrategy(strategy.id, { source: 'manual' });
    }
}

async function resolveOptionalGoal(userId, body) {
    // goal_uid: undefined = leave unchanged; null/'' = detach; string = attach.
    if (!('goal_uid' in body)) return undefined;
    if (body.goal_uid == null || body.goal_uid === '') return null;
    const goal = await repo.goalByUid(userId, body.goal_uid);
    if (!goal) throw new NotFoundError('Goal not found');
    return goal.id;
}

async function listStrategies(userId, goalUid) {
    const goal = await repo.goalByUid(userId, goalUid);
    if (!goal) throw new NotFoundError('Goal not found');
    const strategies = await repo.strategiesByGoalId(userId, goal.id);
    return Promise.all(
        strategies.map((strat) => hydrateStrategy(userId, strat))
    );
}

/** All of a user's strategies (used by the /strategy overview + sidebar). */
async function listAllStrategies(userId) {
    const strategies = await repo.strategiesForUser(userId);
    return Promise.all(
        strategies.map((strat) => hydrateStrategy(userId, strat))
    );
}

async function createStrategy(userId, body) {
    const name = v.requireNonEmptyString(body.name, 'name');
    v.assertEnum(body.status, v.STRATEGY_STATUSES, 'status');
    v.assertColor(body.color);
    v.assertBoolean(body.metrics_editable, 'metrics_editable');

    const goalId =
        'goal_uid' in body ? await resolveOptionalGoal(userId, body) : null;

    const sortOrder = (await repo.maxStrategySortOrder(goalId)) + 1;
    const strategy = await repo.createStrategy({
        goal_id: goalId ?? null,
        user_id: userId,
        name,
        description: body.description || null,
        color: body.color || null,
        status: body.status || 'active',
        metrics_editable:
            body.metrics_editable === undefined
                ? true
                : !!body.metrics_editable,
        sort_order: sortOrder,
    });

    if (Array.isArray(body.project_uids) && body.project_uids.length) {
        await syncStrategyProjects(userId, strategy, body.project_uids);
    }
    await recomputeForStrategy(strategy);
    return getStrategy(userId, strategy.uid);
}

async function hydrateStrategy(userId, strategy) {
    const links = await repo.linksForStrategy(strategy.id);
    const projects = await repo.projectsByIds(
        userId,
        links.map((l) => l.project_id)
    );
    const counts = await repo.taskCountsByProject(projects.map((p) => p.id));
    const goal = strategy.goal_id
        ? await repo.goalById(userId, strategy.goal_id)
        : null;
    const projectRefs = projects.map((p) =>
        s.serializeProjectRef(p, percentOf(counts.get(p.id)))
    );
    return s.serializeStrategy(strategy, {
        goal: goal ? { uid: goal.uid, title: goal.title } : null,
        projects: projectRefs,
        project_counts: countByStatus(projectRefs),
    });
}

function countByStatus(projectRefs) {
    const counts = { total: projectRefs.length };
    for (const p of projectRefs) {
        const key = p.status || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

async function getStrategy(userId, uid) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const base = await hydrateStrategy(userId, strategy);
    const [keyResults, milestones, snaps] = await Promise.all([
        repo.keyResults('strategy', strategy.id),
        repo.milestones('strategy', strategy.id),
        repo.snapshots('strategy', strategy.id, { limit: 90 }),
    ]);
    return {
        ...base,
        key_results: keyResults.map(s.serializeKeyResult),
        milestones: milestones.map(s.serializeMilestone),
        trend: snaps.map(s.serializeSnapshot),
    };
}

async function updateStrategy(userId, uid, body) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');

    v.assertEnum(body.status, v.STRATEGY_STATUSES, 'status');
    v.assertColor(body.color);
    v.assertBoolean(body.metrics_editable, 'metrics_editable');

    const prevGoalId = strategy.goal_id;
    const updates = {};
    if (body.name !== undefined)
        updates.name = v.requireNonEmptyString(body.name, 'name');
    if (body.description !== undefined)
        updates.description = body.description || null;
    if (body.color !== undefined) updates.color = body.color || null;
    if (body.status !== undefined) updates.status = body.status;
    if (body.metrics_editable !== undefined)
        updates.metrics_editable = !!body.metrics_editable;
    if (body.sort_order !== undefined)
        updates.sort_order = Number(body.sort_order);

    const resolvedGoalId = await resolveOptionalGoal(userId, body);
    if (resolvedGoalId !== undefined) updates.goal_id = resolvedGoalId;

    await strategy.update(updates);
    if (Array.isArray(body.project_uids)) {
        await syncStrategyProjects(userId, strategy, body.project_uids);
    }
    await recomputeForStrategy(strategy, [prevGoalId]);
    return getStrategy(userId, uid);
}

async function deleteStrategy(userId, uid) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const goalId = strategy.goal_id;
    const {
        GoalshqProjectStrategy,
        GoalshqKeyResult,
        GoalshqMilestone,
    } = require('../../models');
    await sequelize.transaction(async (transaction) => {
        await GoalshqProjectStrategy.destroy({
            where: { strategy_id: strategy.id },
            transaction,
        });
        await GoalshqKeyResult.destroy({
            where: { parent_type: 'strategy', parent_id: strategy.id },
            transaction,
        });
        await GoalshqMilestone.destroy({
            where: { parent_type: 'strategy', parent_id: strategy.id },
            transaction,
        });
        await strategy.destroy({ transaction });
    });
    if (goalId != null) {
        await rollup.recomputeGoal(goalId, { source: 'manual' });
    }
}

/* ------------------------------------------------------- project ↔ strategy */

/** Diff `projectUids` against the strategy's current links and apply the delta. */
async function syncStrategyProjects(userId, strategy, projectUids) {
    const wanted = new Set();
    for (const uid of projectUids || []) {
        // eslint-disable-next-line no-await-in-loop
        const project = await repo.projectByUid(userId, uid);
        if (!project) throw new NotFoundError(`Project not found: ${uid}`);
        wanted.add(project.id);
    }
    const current = new Set(
        (await repo.linksForStrategy(strategy.id)).map((l) => l.project_id)
    );
    for (const pid of wanted) {
        if (!current.has(pid))
            // eslint-disable-next-line no-await-in-loop
            await repo.linkProjectToStrategy(strategy.id, pid, userId);
    }
    for (const pid of current) {
        if (!wanted.has(pid))
            // eslint-disable-next-line no-await-in-loop
            await repo.unlinkProject(strategy.id, pid);
    }
}

async function setStrategyProjects(userId, strategyUid, body) {
    const strategy = await repo.strategyByUid(userId, strategyUid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    if (!Array.isArray(body.project_uids)) {
        throw new ValidationError('project_uids must be an array');
    }
    await syncStrategyProjects(userId, strategy, body.project_uids);
    await recomputeForStrategy(strategy);
    return getStrategy(userId, strategyUid);
}

async function linkProject(userId, strategyUid, body) {
    const strategy = await repo.strategyByUid(userId, strategyUid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const projectUid = v.requireNonEmptyString(body.project_uid, 'project_uid');
    const project = await repo.projectByUid(userId, projectUid);
    if (!project) throw new NotFoundError('Project not found');
    await repo.linkProjectToStrategy(strategy.id, project.id, userId);
    await recomputeForStrategy(strategy);
    return getStrategy(userId, strategyUid);
}

async function unlinkProject(userId, strategyUid, projectUid) {
    const strategy = await repo.strategyByUid(userId, strategyUid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const project = await repo.projectByUid(userId, projectUid);
    if (!project) throw new NotFoundError('Project not found');
    await repo.unlinkProject(strategy.id, project.id);
    await recomputeForStrategy(strategy);
    return getStrategy(userId, strategyUid);
}

/** Project side of the many-to-many: replace a project's strategy set. */
async function setProjectStrategies(userId, projectUid, body) {
    const project = await repo.projectByUid(userId, projectUid);
    if (!project) throw new NotFoundError('Project not found');
    if (!Array.isArray(body.strategy_uids)) {
        throw new ValidationError('strategy_uids must be an array');
    }
    const wanted = new Set();
    for (const uid of body.strategy_uids) {
        // eslint-disable-next-line no-await-in-loop
        const strat = await repo.strategyByUid(userId, uid);
        if (!strat) throw new NotFoundError(`Strategy not found: ${uid}`);
        wanted.add(strat.id);
    }
    const current = new Set(
        (await repo.linksForProject(project.id)).map((l) => l.strategy_id)
    );
    for (const sid of wanted) {
        if (!current.has(sid))
            // eslint-disable-next-line no-await-in-loop
            await repo.linkProjectToStrategy(sid, project.id, userId);
    }
    for (const sid of current) {
        if (!wanted.has(sid))
            // eslint-disable-next-line no-await-in-loop
            await repo.unlinkProject(sid, project.id);
    }
    await recomputeForProject(project);
    return { strategy_uids: body.strategy_uids };
}

/* ---------------------------------------------------- parent resolution */

async function resolveParent(userId, parentType, uid, allowed) {
    v.assertParentType(parentType, allowed);
    if (parentType === 'goal') {
        const goal = await repo.goalByUid(userId, uid);
        if (!goal) throw new NotFoundError('Goal not found');
        return { type: 'goal', id: goal.id, goalId: goal.id };
    }
    if (parentType === 'project') {
        const project = await repo.projectByUid(userId, uid);
        if (!project) throw new NotFoundError('Project not found');
        return {
            type: 'project',
            id: project.id,
            goalId: project.goal_id || null,
        };
    }
    if (parentType === 'task') {
        const task = await repo.taskByUid(userId, uid);
        if (!task) throw new NotFoundError('Task not found');
        // Informational only — never triggers a rollup recompute (see AF3).
        return { type: 'task', id: task.id, goalId: null };
    }
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    return { type: 'strategy', id: strategy.id, goalId: strategy.goal_id };
}

/* ------------------------------------------------------------- key results */

async function listKeyResults(userId, parentType, uid) {
    const parent = await resolveParent(
        userId,
        parentType,
        uid,
        v.KEY_RESULT_PARENT_TYPES
    );
    const rows = await repo.keyResults(parent.type, parent.id);
    return rows.map(s.serializeKeyResult);
}

async function createKeyResult(userId, parentType, uid, body) {
    const parent = await resolveParent(
        userId,
        parentType,
        uid,
        v.KEY_RESULT_PARENT_TYPES
    );
    const name = v.requireNonEmptyString(body.name, 'name');
    v.assertEnum(body.direction, v.KR_DIRECTIONS, 'direction');
    v.assertEnum(body.auto_source, v.KR_AUTO_SOURCES, 'auto_source');
    v.assertNumber(body.baseline_value, 'baseline_value');
    v.assertNumber(body.target_value, 'target_value');
    v.assertNumber(body.current_value, 'current_value');
    if (body.target_value === undefined || body.target_value === null) {
        throw new ValidationError('target_value is required');
    }

    const kr = await repo.createKeyResult({
        parent_type: parent.type,
        parent_id: parent.id,
        user_id: userId,
        name,
        unit: body.unit || null,
        direction: body.direction || 'increase',
        auto_source: body.auto_source || 'manual',
        baseline_value: Number(body.baseline_value || 0),
        target_value: Number(body.target_value),
        current_value: Number(body.current_value || 0),
        sort_order: Number(body.sort_order || 0),
    });
    if (parent.type !== 'task' && parent.goalId) {
        await rollup.recomputeGoal(parent.goalId, { source: 'manual' });
    }
    return s.serializeKeyResult(kr);
}

async function updateKeyResult(userId, uid, body) {
    const kr = await repo.keyResultByUid(userId, uid);
    if (!kr) throw new NotFoundError('Key result not found');
    v.assertEnum(body.direction, v.KR_DIRECTIONS, 'direction');
    v.assertEnum(body.auto_source, v.KR_AUTO_SOURCES, 'auto_source');
    v.assertNumber(body.baseline_value, 'baseline_value');
    v.assertNumber(body.target_value, 'target_value');
    v.assertNumber(body.current_value, 'current_value');

    const updates = {};
    if (body.name !== undefined)
        updates.name = v.requireNonEmptyString(body.name, 'name');
    if (body.unit !== undefined) updates.unit = body.unit || null;
    if (body.direction !== undefined) updates.direction = body.direction;
    if (body.auto_source !== undefined) updates.auto_source = body.auto_source;
    if (body.baseline_value !== undefined)
        updates.baseline_value = Number(body.baseline_value);
    if (body.target_value !== undefined)
        updates.target_value = Number(body.target_value);
    if (body.current_value !== undefined)
        updates.current_value = Number(body.current_value);
    if (body.sort_order !== undefined)
        updates.sort_order = Number(body.sort_order);

    await kr.update(updates);
    await recomputeForParent(kr.parent_type, kr.parent_id, userId);
    return s.serializeKeyResult(await repo.keyResultByUid(userId, uid));
}

async function deleteKeyResult(userId, uid) {
    const kr = await repo.keyResultByUid(userId, uid);
    if (!kr) throw new NotFoundError('Key result not found');
    const { parent_type, parent_id } = kr;
    await kr.destroy();
    await recomputeForParent(parent_type, parent_id, userId);
}

/* --------------------------------------------------------------- milestones */

async function serializeMilestoneFull(userId, m) {
    const { Task } = require('../../models');
    const links = await repo.milestoneTaskLinks(m.id);
    const tasks = links.length
        ? await Task.findAll({
              where: { id: links.map((l) => l.task_id) },
              attributes: ['uid'],
          })
        : [];
    let autoKrUid = null;
    if (m.auto_kr_id) {
        const kr = await repo.keyResultById(userId, m.auto_kr_id);
        autoKrUid = kr ? kr.uid : null;
    }
    return s.serializeMilestone(m, {
        taskUids: tasks.map((t) => t.uid),
        autoKrUid,
    });
}

async function listMilestones(userId, parentType, uid) {
    const parent = await resolveParent(userId, parentType, uid);
    const rows = await repo.milestones(parent.type, parent.id);
    return Promise.all(rows.map((m) => serializeMilestoneFull(userId, m)));
}

async function createMilestone(userId, parentType, uid, body) {
    const parent = await resolveParent(userId, parentType, uid);
    const title = v.requireNonEmptyString(body.title, 'title');
    v.assertEnum(body.status, v.MILESTONE_STATUSES, 'status');
    v.assertDate(body.target_date, 'target_date');
    v.assertNumber(body.target_value, 'target_value');

    const status = body.status || 'pending';
    const milestone = await repo.createMilestone({
        parent_type: parent.type,
        parent_id: parent.id,
        user_id: userId,
        title,
        target_date: body.target_date || null,
        target_value:
            body.target_value == null ? null : Number(body.target_value),
        status,
        achieved_at: status === 'achieved' ? new Date() : null,
        sort_order: Number(body.sort_order || 0),
    });
    await recomputeForParent(parent.type, parent.id, userId);
    return serializeMilestoneFull(userId, milestone);
}

async function updateMilestone(userId, uid, body) {
    const milestone = await repo.milestoneByUid(userId, uid);
    if (!milestone) throw new NotFoundError('Milestone not found');
    v.assertEnum(body.status, v.MILESTONE_STATUSES, 'status');
    v.assertEnum(body.completion_mode, ['all', 'any'], 'completion_mode');
    v.assertDate(body.target_date, 'target_date');
    v.assertNumber(body.target_value, 'target_value');
    v.assertNumber(body.auto_kr_threshold, 'auto_kr_threshold');

    const updates = {};
    if (body.title !== undefined)
        updates.title = v.requireNonEmptyString(body.title, 'title');
    if (body.target_date !== undefined)
        updates.target_date = body.target_date || null;
    if (body.target_value !== undefined)
        updates.target_value =
            body.target_value == null ? null : Number(body.target_value);
    if (body.sort_order !== undefined)
        updates.sort_order = Number(body.sort_order);
    if (body.completion_mode !== undefined)
        updates.completion_mode = body.completion_mode;
    if (body.auto_kr_threshold !== undefined)
        updates.auto_kr_threshold =
            body.auto_kr_threshold == null
                ? null
                : Number(body.auto_kr_threshold);
    if (body.auto_kr_uid !== undefined) {
        if (!body.auto_kr_uid) {
            updates.auto_kr_id = null;
        } else {
            const kr = await repo.keyResultByUid(userId, body.auto_kr_uid);
            if (!kr) throw new NotFoundError('Key result not found');
            updates.auto_kr_id = kr.id;
        }
    }
    if (body.status !== undefined) {
        updates.status = body.status;
        updates.auto_achieved = false;
        updates.achieved_at =
            body.status === 'achieved'
                ? milestone.achieved_at || new Date()
                : null;
    }

    await milestone.update(updates);
    await recomputeForParent(
        milestone.parent_type,
        milestone.parent_id,
        userId
    );
    return serializeMilestoneFull(
        userId,
        await repo.milestoneByUid(userId, uid)
    );
}

async function deleteMilestone(userId, uid) {
    const milestone = await repo.milestoneByUid(userId, uid);
    if (!milestone) throw new NotFoundError('Milestone not found');
    const { parent_type, parent_id } = milestone;
    await milestone.destroy();
    await recomputeForParent(parent_type, parent_id, userId);
}

/**
 * Phase F — "Expand into tasks": a manual, one-shot action that creates a
 * single task from a milestone (name = milestone title, due_date = milestone
 * target_date), linked into whatever scope the milestone already lives in.
 * Deliberately not automatic and not AI-driven in this pass — see the Phase F
 * plan entry for "Auto-expand coarse phase -> daily tasks near checkpoint".
 */
async function expandMilestone(userId, uid) {
    const milestone = await repo.milestoneByUid(userId, uid);
    if (!milestone) throw new NotFoundError('Milestone not found');

    const taskData = {
        user_id: userId,
        name: milestone.title,
        due_date: milestone.target_date || null,
    };
    if (milestone.parent_type === 'project') {
        taskData.project_id = milestone.parent_id;
    } else if (milestone.parent_type === 'goal') {
        taskData.goal_id = milestone.parent_id;
    } else if (milestone.parent_type === 'strategy') {
        const strategy = await GoalshqStrategy.findOne({
            where: { id: milestone.parent_id, user_id: userId },
        });
        if (strategy) taskData.goal_id = strategy.goal_id;
    }

    const task = await Task.create(taskData);

    // Auto-link the task so completing it closes this milestone.
    const { GoalshqMilestoneTask } = require('../../models');
    await GoalshqMilestoneTask.findOrCreate({
        where: { milestone_id: milestone.id, task_id: task.id },
        defaults: {
            milestone_id: milestone.id,
            task_id: task.id,
            user_id: userId,
        },
    });

    return {
        uid: task.uid,
        name: task.name,
        due_date: task.due_date,
    };
}

/* ---------------------------------------------------------------- recompute */

async function recomputeForProject(project) {
    if (project && project.goal_id) {
        return rollup.recomputeGoal(project.goal_id, { source: 'manual' });
    }
    if (project) {
        return rollup.recomputeProject(project.id, { source: 'manual' });
    }
    return null;
}

async function recomputeForParent(parentType, parentId, userId) {
    if (parentType === 'task') {
        // Informational only — a task-parented KeyResult never feeds a rollup.
        return null;
    }
    if (parentType === 'goal') {
        return rollup.recomputeGoal(parentId, { source: 'manual' });
    }
    if (parentType === 'project') {
        const { Project } = require('../../models');
        const project = await Project.findOne({
            where: { id: parentId, user_id: userId },
        });
        return recomputeForProject(project);
    }
    const strategy = await require('../../models').GoalshqStrategy.findOne({
        where: { id: parentId, user_id: userId },
    });
    if (strategy) {
        return rollup.recomputeStrategy(strategy.id, { source: 'manual' });
    }
    return null;
}

async function recomputeGoal(userId, uid) {
    const goal = await repo.goalByUid(userId, uid);
    if (!goal) throw new NotFoundError('Goal not found');
    await rollup.recomputeGoal(goal.id, { source: 'manual' });
    return getGoalDetail(userId, uid, { recompute: false });
}

async function recomputeStrategy(userId, uid) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    await rollup.recomputeStrategy(strategy.id, { source: 'manual' });
    return getStrategy(userId, uid);
}

/* ============================================================ Part 2: records */

const { GoalshqRecord, GoalshqKeyResult, Attachment } = require('../../models');
const { getFileUrl } = require('../../utils/attachment-utils');
const aggregate = require('./operations/aggregate');
const report = require('./operations/report');

async function attachmentsForRecord(recordId) {
    const rows = await Attachment.findAll({
        where: { parent_type: 'goalshq_record', parent_id: recordId },
        order: [['created_at', 'ASC']],
    });
    return rows.map((a) => ({
        uid: a.uid,
        original_filename: a.original_filename,
        mime_type: a.mime_type,
        file_size: a.file_size,
        file_url: getFileUrl(a.stored_filename, 'attachments'),
    }));
}

async function serializeRecordFull(r) {
    return s.serializeRecord(r, {
        attachments: await attachmentsForRecord(r.id),
    });
}

async function recomputeForParentType(parentType, parentId, userId) {
    if (parentType === 'goal') {
        return rollup.recomputeGoal(parentId, { source: 'manual' });
    }
    if (parentType === 'project') {
        const { Project } = require('../../models');
        return recomputeForProject(
            await Project.findOne({
                where: { id: parentId, user_id: userId },
            })
        );
    }
    return rollup.recomputeStrategy(parentId, { source: 'manual' });
}

async function listRecords(userId, parentType, uid) {
    const parent = await resolveParent(userId, parentType, uid, [
        'goal',
        'strategy',
        'project',
    ]);
    const rows = await repo.records(parent.type, parent.id);
    return Promise.all(rows.map(serializeRecordFull));
}

async function resolveCountsTowardKr(userId, krUid) {
    if (!krUid) return null;
    const kr = await repo.keyResultByUid(userId, krUid);
    if (!kr) throw new NotFoundError('Key result not found');
    return kr.id;
}

async function createRecord(userId, parentType, uid, body) {
    const parent = await resolveParent(userId, parentType, uid, [
        'goal',
        'strategy',
        'project',
    ]);
    const title = v.requireNonEmptyString(body.title, 'title');
    v.assertDate(body.record_date, 'record_date');
    v.assertNumber(body.amount, 'amount');

    let taskId = null;
    if (body.task_uid) {
        const task = await repo.taskByUid(userId, body.task_uid);
        if (task) taskId = task.id;
    }

    const record = await repo.createRecord({
        parent_type: parent.type,
        parent_id: parent.id,
        user_id: userId,
        created_by: userId,
        record_date: body.record_date || new Date().toISOString().slice(0, 10),
        title,
        category: body.category || null,
        amount: body.amount == null ? null : Number(body.amount),
        unit: body.unit || null,
        status: body.status || null,
        counts_toward_kr_id: await resolveCountsTowardKr(
            userId,
            body.counts_toward_kr_uid
        ),
        evidence_url: body.evidence_url || null,
        task_id: taskId,
        body: body.body || null,
    });
    await recomputeForParentType(parent.type, parent.id, userId);
    return serializeRecordFull(record);
}

async function updateRecord(userId, uid, body) {
    const record = await repo.recordByUid(userId, uid);
    if (!record) throw new NotFoundError('Record not found');
    v.assertDate(body.record_date, 'record_date');
    v.assertNumber(body.amount, 'amount');
    const updates = {};
    for (const f of [
        'title',
        'category',
        'unit',
        'status',
        'evidence_url',
        'body',
    ]) {
        if (body[f] !== undefined) updates[f] = body[f] || null;
    }
    if (body.record_date !== undefined)
        updates.record_date = body.record_date || record.record_date;
    if (body.amount !== undefined)
        updates.amount = body.amount == null ? null : Number(body.amount);
    if (body.counts_toward_kr_uid !== undefined)
        updates.counts_toward_kr_id = await resolveCountsTowardKr(
            userId,
            body.counts_toward_kr_uid
        );
    await record.update(updates);
    await recomputeForParentType(record.parent_type, record.parent_id, userId);
    return serializeRecordFull(await repo.recordByUid(userId, uid));
}

async function deleteRecord(userId, uid) {
    const record = await repo.recordByUid(userId, uid);
    if (!record) throw new NotFoundError('Record not found');
    const { parent_type, parent_id } = record;
    const files = await Attachment.findAll({
        where: { parent_type: 'goalshq_record', parent_id: record.id },
    });
    const { deleteFileFromDisk } = require('../../utils/attachment-utils');
    const path = require('path');
    const { getConfig } = require('../../config/config');
    for (const f of files) {
        await deleteFileFromDisk(
            path.join(getConfig().uploadPath, f.file_path)
        );
        await f.destroy();
    }
    await record.destroy();
    await recomputeForParentType(parent_type, parent_id, userId);
}

/* --------------------------------------------------------- KR check-in entries */

async function listKrEntries(userId, krUid) {
    const kr = await repo.keyResultByUid(userId, krUid);
    if (!kr) throw new NotFoundError('Key result not found');
    return (await repo.krEntries(kr.id)).map(s.serializeKrEntry);
}

async function createKrEntry(userId, krUid, body) {
    const kr = await repo.keyResultByUid(userId, krUid);
    if (!kr) throw new NotFoundError('Key result not found');
    v.assertNumber(body.value, 'value');
    if (body.value === undefined || body.value === null) {
        throw new ValidationError('value is required');
    }
    v.assertDate(body.entry_date, 'entry_date');
    const entry = await repo.createKrEntry({
        key_result_id: kr.id,
        user_id: userId,
        entry_date: body.entry_date || new Date().toISOString().slice(0, 10),
        value: Number(body.value),
        note: body.note || null,
    });
    // A manual KR follows its latest check-in.
    if (kr.auto_source === 'manual') {
        await kr.update({ current_value: Number(body.value) });
    }
    await recomputeForParent(kr.parent_type, kr.parent_id, userId);
    return s.serializeKrEntry(entry);
}

/* ------------------------------------------------------------ KR propagation */

async function propagateKeyResult(userId, krUid, body) {
    const kr = await repo.keyResultByUid(userId, krUid);
    if (!kr) throw new NotFoundError('Key result not found');
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    if (nodes.length === 0) throw new ValidationError('nodes is required');

    const existingChildKeys = new Set(
        (await repo.childKeyResults(kr.id)).map(
            (c) => `${c.parent_type}:${c.parent_id}`
        )
    );

    let sortOrder = 0;
    for (const node of nodes) {
        const parent = await resolveParent(
            userId,
            node.parent_type,
            node.parent_uid,
            ['goal', 'strategy', 'project']
        );
        const key = `${parent.type}:${parent.id}`;
        if (existingChildKeys.has(key)) continue;
        // eslint-disable-next-line no-await-in-loop
        await repo.createKeyResult({
            parent_type: parent.type,
            parent_id: parent.id,
            user_id: userId,
            name: kr.name,
            unit: kr.unit,
            direction: kr.direction,
            auto_source: 'manual',
            parent_kr_id: kr.id,
            baseline_value: 0,
            target_value: 0,
            current_value: 0,
            sort_order: sortOrder++,
        });
    }
    // The parent KR now rolls its children up.
    if (kr.auto_source !== 'child_kr_sum') {
        await kr.update({ auto_source: 'child_kr_sum' });
    }
    await recomputeForParent(kr.parent_type, kr.parent_id, userId);
    return getKeyResultDetail(userId, krUid);
}

async function getKeyResultDetail(userId, krUid) {
    const kr = await repo.keyResultByUid(userId, krUid);
    if (!kr) throw new NotFoundError('Key result not found');
    const [children, entries, totals] = await Promise.all([
        repo.childKeyResults(kr.id),
        repo.krEntries(kr.id),
        aggregate.recordTotalsByKr([kr.id]),
    ]);
    const parentKr = kr.parent_kr_id
        ? await GoalshqKeyResult.findByPk(kr.parent_kr_id)
        : null;
    const childTargetSum = children.reduce(
        (acc, c) => acc + Number(c.target_value || 0),
        0
    );
    return s.serializeKeyResult(kr, {
        parent_kr_uid: parentKr ? parentKr.uid : null,
        children: children.map((c) => c.uid),
        coverage:
            kr.auto_source === 'child_kr_sum'
                ? {
                      child_target_sum: childTargetSum,
                      target: Number(kr.target_value || 0),
                      gap: Number(kr.target_value || 0) - childTargetSum,
                  }
                : null,
        entries: entries.map(s.serializeKrEntry),
        record_totals: totals.get(kr.id) || { sum: 0, count: 0 },
    });
}

/* --------------------------------------------------------- milestone triggers */

async function setMilestoneTasks(userId, milestoneUid, taskUids) {
    const milestone = await repo.milestoneByUid(userId, milestoneUid);
    if (!milestone) throw new NotFoundError('Milestone not found');
    const { GoalshqMilestoneTask } = require('../../models');
    const wanted = new Set();
    for (const uid of taskUids || []) {
        // eslint-disable-next-line no-await-in-loop
        const task = await repo.taskByUid(userId, uid);
        if (task) wanted.add(task.id);
    }
    const current = new Set(
        (await repo.milestoneTaskLinks(milestone.id)).map((l) => l.task_id)
    );
    for (const tid of wanted) {
        if (!current.has(tid))
            // eslint-disable-next-line no-await-in-loop
            await GoalshqMilestoneTask.create({
                milestone_id: milestone.id,
                task_id: tid,
                user_id: userId,
            });
    }
    for (const tid of current) {
        if (!wanted.has(tid))
            // eslint-disable-next-line no-await-in-loop
            await GoalshqMilestoneTask.destroy({
                where: { milestone_id: milestone.id, task_id: tid },
            });
    }
    await recomputeForParent(
        milestone.parent_type,
        milestone.parent_id,
        userId
    );
    return listMilestones(
        userId,
        milestone.parent_type,
        await parentUidFor(milestone.parent_type, milestone.parent_id)
    );
}

async function parentUidFor(parentType, parentId) {
    const { Goal, Project } = require('../../models');
    if (parentType === 'goal') return (await Goal.findByPk(parentId)).uid;
    if (parentType === 'project') return (await Project.findByPk(parentId)).uid;
    return (await GoalshqStrategy.findByPk(parentId)).uid;
}

/* ------------------------------------------------------------------ report */

async function getReport(userId, parentType, uid, query = {}) {
    const parent = await resolveParent(userId, parentType, uid, [
        'goal',
        'strategy',
        'project',
    ]);
    return report.assemble(userId, parent.type, parent.id, {
        period: query.period,
        withNarrative: query.narrative !== 'false',
    });
}

module.exports = {
    isEnabled,
    listGoals,
    getGoalDetail,
    updateGoalSettings,
    getProjectDetail,
    updateProjectSettings,
    listStrategies,
    listAllStrategies,
    createStrategy,
    getStrategy,
    updateStrategy,
    deleteStrategy,
    linkProject,
    unlinkProject,
    setStrategyProjects,
    setProjectStrategies,
    listKeyResults,
    createKeyResult,
    updateKeyResult,
    deleteKeyResult,
    listMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    expandMilestone,
    recomputeGoal,
    recomputeStrategy,
    // Part 2
    listRecords,
    createRecord,
    updateRecord,
    deleteRecord,
    listKrEntries,
    createKrEntry,
    propagateKeyResult,
    getKeyResultDetail,
    setMilestoneTasks,
    getReport,
};
