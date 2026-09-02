'use strict';

const t = require('./core/tududi');
const repo = require('./repository');
const rollup = require('./operations/rollup');
const math = require('./operations/progress-math');
const v = require('./validation');
const s = require('./core/serializers');

const { errors } = t;
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

    return goals
        .map((g) =>
            s.serializeGoalSummary(
                g,
                settingsMap.get(g.id),
                strategyMap.get(g.id) || []
            )
        )
        .sort(byRiskThenTitle);
}

function healthRank(h) {
    return { off_track: 0, at_risk: 1, no_data: 2, on_track: 3 }[h] ?? 2;
}

function byRiskThenTitle(a, b) {
    const r = healthRank(a.health) - healthRank(b.health);
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
            repo.snapshots('goal', goal.id, { limit: 90 }),
        ]);

    // direct-bucket projects: goal_id === goal AND not linked to a strategy
    const linkedIds = await repo.linkedProjectIdsForGoal(userId, goal.id);
    const goalProjects = await repo.projectsForGoal(userId, goal.id);
    const directProjects = goalProjects.filter(
        (p) => !linkedIds.includes(p.id)
    );
    const directCounts = await repo.taskCountsByProject(
        directProjects.map((p) => p.id)
    );

    // per-strategy project breakdown
    const strategyOut = [];
    for (const strat of strategies) {
        // eslint-disable-next-line no-await-in-loop
        const links = await repo.linksForStrategy(strat.id);
        const pids = links.map((l) => l.project_id);
        // eslint-disable-next-line no-await-in-loop
        const projects = await repo.projectsByIds(userId, pids);
        // eslint-disable-next-line no-await-in-loop
        const counts = await repo.taskCountsByProject(pids);
        strategyOut.push(
            s.serializeStrategy(strat, {
                projects: projects.map((p) =>
                    s.serializeProjectRef(p, percentOf(counts.get(p.id)))
                ),
            })
        );
    }

    return {
        uid: goal.uid,
        title: goal.title,
        why: goal.why,
        status: goal.status,
        horizon: goal.horizon,
        target_date: goal.target_date,
        color: goal.color,
        settings: s.serializeSettings(settings),
        percent:
            settings.cached_percent == null
                ? null
                : Number(settings.cached_percent),
        health: settings.cached_health || 'no_data',
        strategies: strategyOut,
        key_results: keyResults.map(s.serializeKeyResult),
        milestones: milestones.map(s.serializeMilestone),
        direct_projects: directProjects.map((p) =>
            s.serializeProjectRef(p, percentOf(directCounts.get(p.id)))
        ),
        trend: snaps.map(s.serializeSnapshot),
    };
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

    v.assertEnum(body.progress_mode, v.GOAL_PROGRESS_MODES, 'progress_mode');
    v.assertImportance(body.importance);
    v.assertDate(body.start_date, 'start_date');
    v.assertPercent(body.manual_percent, 'manual_percent');

    const updates = {};
    if (body.progress_mode !== undefined)
        updates.progress_mode = body.progress_mode;
    if (body.importance !== undefined)
        updates.importance = Number(body.importance);
    if (body.weight_by_priority !== undefined)
        updates.weight_by_priority = !!body.weight_by_priority;
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

/* -------------------------------------------------------------- strategies */

async function listStrategies(userId, goalUid) {
    const goal = await repo.goalByUid(userId, goalUid);
    if (!goal) throw new NotFoundError('Goal not found');
    const strategies = await repo.strategiesByGoalId(userId, goal.id);
    return strategies.map((strat) => s.serializeStrategy(strat));
}

async function createStrategy(userId, goalUid, body) {
    const goal = await repo.goalByUid(userId, goalUid);
    if (!goal) throw new NotFoundError('Goal not found');

    const name = v.requireNonEmptyString(body.name, 'name');
    v.assertEnum(body.kind, v.STRATEGY_KINDS, 'kind');
    v.assertEnum(body.status, v.STRATEGY_STATUSES, 'status');
    v.assertEnum(
        body.progress_mode,
        v.STRATEGY_PROGRESS_MODES,
        'progress_mode'
    );
    v.assertImportance(body.importance);
    v.assertDate(body.start_date, 'start_date');
    v.assertDate(body.target_date, 'target_date');
    v.assertPercent(body.manual_percent, 'manual_percent');

    const sortOrder = (await repo.maxStrategySortOrder(goal.id)) + 1;
    const strategy = await repo.createStrategy({
        goal_id: goal.id,
        user_id: userId,
        name,
        description: body.description || null,
        kind: body.kind || 'primary',
        status: body.status || 'active',
        horizon_label: body.horizon_label || null,
        start_date: body.start_date || null,
        target_date: body.target_date || null,
        importance: body.importance ? Number(body.importance) : 3,
        progress_mode: body.progress_mode || 'rollup_projects',
        weight_by_priority: !!body.weight_by_priority,
        manual_percent:
            body.manual_percent == null ? null : Number(body.manual_percent),
        sort_order: sortOrder,
    });

    await rollup.recomputeGoal(goal.id, { source: 'manual' });
    return s.serializeStrategy(strategy);
}

async function getStrategy(userId, uid) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const links = await repo.linksForStrategy(strategy.id);
    const projects = await repo.projectsByIds(
        userId,
        links.map((l) => l.project_id)
    );
    const counts = await repo.taskCountsByProject(projects.map((p) => p.id));
    const [keyResults, milestones, snaps] = await Promise.all([
        repo.keyResults('strategy', strategy.id),
        repo.milestones('strategy', strategy.id),
        repo.snapshots('strategy', strategy.id, { limit: 90 }),
    ]);
    return s.serializeStrategy(strategy, {
        projects: projects.map((p) =>
            s.serializeProjectRef(p, percentOf(counts.get(p.id)))
        ),
        key_results: keyResults.map(s.serializeKeyResult),
        milestones: milestones.map(s.serializeMilestone),
        trend: snaps.map(s.serializeSnapshot),
    });
}

async function updateStrategy(userId, uid, body) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');

    v.assertEnum(body.kind, v.STRATEGY_KINDS, 'kind');
    v.assertEnum(body.status, v.STRATEGY_STATUSES, 'status');
    v.assertEnum(
        body.progress_mode,
        v.STRATEGY_PROGRESS_MODES,
        'progress_mode'
    );
    v.assertImportance(body.importance);
    v.assertDate(body.start_date, 'start_date');
    v.assertDate(body.target_date, 'target_date');
    v.assertPercent(body.manual_percent, 'manual_percent');

    const updates = {};
    if (body.name !== undefined)
        updates.name = v.requireNonEmptyString(body.name, 'name');
    if (body.description !== undefined)
        updates.description = body.description || null;
    if (body.kind !== undefined) updates.kind = body.kind;
    if (body.status !== undefined) updates.status = body.status;
    if (body.horizon_label !== undefined)
        updates.horizon_label = body.horizon_label || null;
    if (body.start_date !== undefined)
        updates.start_date = body.start_date || null;
    if (body.target_date !== undefined)
        updates.target_date = body.target_date || null;
    if (body.importance !== undefined)
        updates.importance = Number(body.importance);
    if (body.progress_mode !== undefined)
        updates.progress_mode = body.progress_mode;
    if (body.weight_by_priority !== undefined)
        updates.weight_by_priority = !!body.weight_by_priority;
    if (body.manual_percent !== undefined)
        updates.manual_percent =
            body.manual_percent === null ? null : Number(body.manual_percent);
    if (body.sort_order !== undefined)
        updates.sort_order = Number(body.sort_order);

    await strategy.update(updates);
    await rollup.recomputeGoal(strategy.goal_id, { source: 'manual' });
    return s.serializeStrategy(await repo.strategyByUid(userId, uid));
}

async function deleteStrategy(userId, uid) {
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const goalId = strategy.goal_id;
    await t.sequelize.transaction(async (transaction) => {
        const {
            GoalshqProjectStrategy,
            GoalshqKeyResult,
            GoalshqMilestone,
        } = require('./models');
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
    await rollup.recomputeGoal(goalId, { source: 'manual' });
}

/* ------------------------------------------------------- project ↔ strategy */

async function linkProject(userId, strategyUid, body) {
    const strategy = await repo.strategyByUid(userId, strategyUid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const projectUid = v.requireNonEmptyString(body.project_uid, 'project_uid');
    const project = await repo.projectByUid(userId, projectUid);
    if (!project) throw new NotFoundError('Project not found');

    let weight = body.weight;
    if (weight !== undefined) {
        v.assertNumber(weight, 'weight');
        weight = Number(weight);
        if (weight <= 0) throw new ValidationError('weight must be positive');
    }

    await repo.linkProjectToStrategy(strategy.id, project.id, userId, weight);
    await rollup.recomputeGoal(strategy.goal_id, { source: 'manual' });
    return getStrategy(userId, strategyUid);
}

async function unlinkProject(userId, strategyUid, projectUid) {
    const strategy = await repo.strategyByUid(userId, strategyUid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    const project = await repo.projectByUid(userId, projectUid);
    if (!project) throw new NotFoundError('Project not found');
    await repo.unlinkProject(strategy.id, project.id);
    await rollup.recomputeGoal(strategy.goal_id, { source: 'manual' });
    return getStrategy(userId, strategyUid);
}

/* ---------------------------------------------------- parent resolution */

async function resolveParent(userId, parentType, uid) {
    v.assertParentType(parentType);
    if (parentType === 'goal') {
        const goal = await repo.goalByUid(userId, uid);
        if (!goal) throw new NotFoundError('Goal not found');
        return { type: 'goal', id: goal.id, goalId: goal.id };
    }
    const strategy = await repo.strategyByUid(userId, uid);
    if (!strategy) throw new NotFoundError('Strategy not found');
    return { type: 'strategy', id: strategy.id, goalId: strategy.goal_id };
}

/* ------------------------------------------------------------- key results */

async function listKeyResults(userId, parentType, uid) {
    const parent = await resolveParent(userId, parentType, uid);
    const rows = await repo.keyResults(parent.type, parent.id);
    return rows.map(s.serializeKeyResult);
}

async function createKeyResult(userId, parentType, uid, body) {
    const parent = await resolveParent(userId, parentType, uid);
    const name = v.requireNonEmptyString(body.name, 'name');
    v.assertEnum(body.direction, v.KR_DIRECTIONS, 'direction');
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
        baseline_value: Number(body.baseline_value || 0),
        target_value: Number(body.target_value),
        current_value: Number(body.current_value || 0),
        sort_order: Number(body.sort_order || 0),
    });
    await rollup.recomputeGoal(parent.goalId, { source: 'manual' });
    return s.serializeKeyResult(kr);
}

async function updateKeyResult(userId, uid, body) {
    const kr = await repo.keyResultByUid(userId, uid);
    if (!kr) throw new NotFoundError('Key result not found');
    v.assertEnum(body.direction, v.KR_DIRECTIONS, 'direction');
    v.assertNumber(body.baseline_value, 'baseline_value');
    v.assertNumber(body.target_value, 'target_value');
    v.assertNumber(body.current_value, 'current_value');

    const updates = {};
    if (body.name !== undefined)
        updates.name = v.requireNonEmptyString(body.name, 'name');
    if (body.unit !== undefined) updates.unit = body.unit || null;
    if (body.direction !== undefined) updates.direction = body.direction;
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

async function listMilestones(userId, parentType, uid) {
    const parent = await resolveParent(userId, parentType, uid);
    const rows = await repo.milestones(parent.type, parent.id);
    return rows.map(s.serializeMilestone);
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
    await rollup.recomputeGoal(parent.goalId, { source: 'manual' });
    return s.serializeMilestone(milestone);
}

async function updateMilestone(userId, uid, body) {
    const milestone = await repo.milestoneByUid(userId, uid);
    if (!milestone) throw new NotFoundError('Milestone not found');
    v.assertEnum(body.status, v.MILESTONE_STATUSES, 'status');
    v.assertDate(body.target_date, 'target_date');
    v.assertNumber(body.target_value, 'target_value');

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
    if (body.status !== undefined) {
        updates.status = body.status;
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
    return s.serializeMilestone(await repo.milestoneByUid(userId, uid));
}

async function deleteMilestone(userId, uid) {
    const milestone = await repo.milestoneByUid(userId, uid);
    if (!milestone) throw new NotFoundError('Milestone not found');
    const { parent_type, parent_id } = milestone;
    await milestone.destroy();
    await recomputeForParent(parent_type, parent_id, userId);
}

/* ---------------------------------------------------------------- recompute */

async function recomputeForParent(parentType, parentId, userId) {
    if (parentType === 'goal') {
        return rollup.recomputeGoal(parentId, { source: 'manual' });
    }
    const strategy = await require('./models').GoalshqStrategy.findOne({
        where: { id: parentId, user_id: userId },
    });
    if (strategy) {
        return rollup.recomputeGoal(strategy.goal_id, { source: 'manual' });
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
    await rollup.recomputeGoal(strategy.goal_id, { source: 'manual' });
    return getStrategy(userId, uid);
}

module.exports = {
    isEnabled,
    listGoals,
    getGoalDetail,
    updateGoalSettings,
    listStrategies,
    createStrategy,
    getStrategy,
    updateStrategy,
    deleteStrategy,
    linkProject,
    unlinkProject,
    listKeyResults,
    createKeyResult,
    updateKeyResult,
    deleteKeyResult,
    listMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    recomputeGoal,
    recomputeStrategy,
};
