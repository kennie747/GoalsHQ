'use strict';

/**
 * Data access for GoalsHQ. Every query is scoped by user_id. Core models
 * (Goal, Project, Area) and the GoalsHQ models are both now registered on the
 * shared Sequelize instance in backend/models/index.js with real associations
 * (see docs/goalshq/adr/0002-first-class-integration.md).
 */

const { Op, fn, col } = require('sequelize');
const {
    Goal,
    Project,
    Task,
    Area,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('../../models');
const {
    DONE_STATUSES,
    EXCLUDED_STATUSES,
} = require('./operations/task-status');

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

async function taskByUid(userId, uid) {
    return Task.findOne({ where: { uid, user_id: userId } });
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

async function findOrCreateProjectSettings(projectId, userId) {
    const [settings] = await GoalshqProjectSettings.findOrCreate({
        where: { project_id: projectId },
        defaults: { project_id: projectId, user_id: userId },
    });
    return settings;
}

async function projectSettingsByIds(projectIds) {
    if (projectIds.length === 0) return new Map();
    const rows = await GoalshqProjectSettings.findAll({
        where: { project_id: { [Op.in]: projectIds } },
    });
    return new Map(rows.map((r) => [r.project_id, r]));
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

/**
 * Link a project to a strategy. A project may already be linked to other
 * strategies — this only ever touches the (strategyId, projectId) pair itself:
 * creates it if new, or updates its weight if it already exists. It never
 * detaches the project from a different strategy (see moveProjectLink for
 * that explicit, opt-in operation).
 */
async function linkProjectToStrategy(strategyId, projectId, userId, weight) {
    const existing = await GoalshqProjectStrategy.findOne({
        where: { strategy_id: strategyId, project_id: projectId },
    });
    if (existing) {
        return existing.update({
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

/**
 * Explicitly move a project's link from one strategy to another (as opposed to
 * simply adding a second link). Returns the removed link's plain data (or null
 * if it didn't exist) and the resulting link.
 */
async function moveProjectLink(
    fromStrategyId,
    toStrategyId,
    projectId,
    userId,
    weight
) {
    const existing = await GoalshqProjectStrategy.findOne({
        where: { strategy_id: fromStrategyId, project_id: projectId },
    });
    const previous = existing ? existing.get({ plain: true }) : null;
    if (existing) {
        await existing.destroy();
    }
    const created = await linkProjectToStrategy(
        toStrategyId,
        projectId,
        userId,
        weight ?? (previous ? previous.weight : undefined)
    );
    return { previous, current: created };
}

async function linksForProject(projectId) {
    return GoalshqProjectStrategy.findAll({
        where: { project_id: projectId },
    });
}

async function linksForStrategy(strategyId) {
    return GoalshqProjectStrategy.findAll({
        where: { strategy_id: strategyId },
    });
}

/** Batched: strategyId -> [project_id, ...], one query for any number of strategies. */
async function linksForStrategies(strategyIds) {
    if (strategyIds.length === 0) return new Map();
    const rows = await GoalshqProjectStrategy.findAll({
        where: { strategy_id: { [Op.in]: strategyIds } },
    });
    const map = new Map();
    for (const link of rows) {
        const list = map.get(link.strategy_id) || [];
        list.push(link.project_id);
        map.set(link.strategy_id, list);
    }
    return map;
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

/** done / total task counts (including subtasks) for a set of project ids, grouped. */
async function taskCountsByProject(projectIds) {
    if (projectIds.length === 0) return new Map();
    const rows = await Task.findAll({
        where: { project_id: { [Op.in]: projectIds } },
        attributes: ['project_id', 'status', [fn('COUNT', col('id')), 'count']],
        group: ['project_id', 'status'],
        raw: true,
    });
    const map = new Map();
    for (const row of rows) {
        const status = Number(row.status);
        if (EXCLUDED_STATUSES.includes(status)) continue;
        const entry = map.get(row.project_id) || { done: 0, total: 0 };
        const count = Number(row.count) || 0;
        entry.total += count;
        if (DONE_STATUSES.includes(status)) entry.done += count;
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

/** Batched: every project directly attached to any of these goals (goal_id FK, not via a strategy link). */
async function projectsForGoalIds(userId, goalIds) {
    if (goalIds.length === 0) return [];
    return Project.findAll({
        where: { goal_id: { [Op.in]: goalIds }, user_id: userId },
        attributes: ['id', 'uid', 'name', 'goal_id'],
    });
}

/** Batched: goalId -> count of tasks attached directly to the goal (task.goal_id), excluding archived/cancelled. */
async function taskCountsByGoalIds(goalIds) {
    if (goalIds.length === 0) return new Map();
    const rows = await Task.findAll({
        where: { goal_id: { [Op.in]: goalIds } },
        attributes: ['goal_id', 'status', [fn('COUNT', col('id')), 'count']],
        group: ['goal_id', 'status'],
        raw: true,
    });
    const map = new Map();
    for (const row of rows) {
        const status = Number(row.status);
        if (EXCLUDED_STATUSES.includes(status)) continue;
        const count = Number(row.count) || 0;
        map.set(row.goal_id, (map.get(row.goal_id) || 0) + count);
    }
    return map;
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
    taskByUid,
    goalsForUser,
    findOrCreateSettings,
    settingsByGoalIds,
    findOrCreateProjectSettings,
    projectSettingsByIds,
    strategiesByGoalId,
    strategiesByGoalIds,
    strategyByUid,
    createStrategy,
    maxStrategySortOrder,
    linkProjectToStrategy,
    unlinkProject,
    moveProjectLink,
    linksForStrategy,
    linksForStrategies,
    linksForProject,
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
    projectsForGoalIds,
    taskCountsByGoalIds,
    projectsByIds,
};
