'use strict';

/**
 * GoalsHQ progress rollup engine.
 *
 * Chain: task bucket → project % → strategy % → goal %, with "direct" buckets
 * (projects linked straight to the goal, and goal-scoped tasks with no project)
 * that skip the strategy tier. All task counting is done with batched GROUP BY
 * queries, never per-entity loops.
 *
 * Writes cached_percent / cached_health / cached_computed_at onto the settings /
 * strategy row and upserts a daily progress snapshot, inside one transaction.
 *
 * Reads join to the live core row and skip anything whose parent goal/project
 * no longer exists (SQLite runs with foreign_keys OFF, so deletes don't cascade
 * into our tables — a nightly GC sweep hard-deletes long-orphaned rows).
 */

const t = require('../core/tududi');
const {
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('../models');
const math = require('./progress-math');
const { DEFAULT_IMPORTANCE } = require('./constants');

const { Op, fn, col, Goal, Project, Task, User, logService } = t;

// Per-process guard so the cron sweep and a recompute-on-read request don't
// stampede the same goal. Keyed by goal id.
const inFlight = new Set();

/* ------------------------------------------------------------------ helpers */

function taskWeight(priority, weightByPriority) {
    return weightByPriority ? 1 + (priority || 0) : 1;
}

/** Fold GROUP BY (status, priority, count) rows into a {doneWeight,totalWeight}. */
function foldBucket(rows, weightByPriority) {
    const bucket = { doneWeight: 0, totalWeight: 0 };
    for (const row of rows) {
        const status = Number(row.status);
        if (t.EXCLUDED_STATUSES.includes(status)) continue;
        const count = Number(row.count) || 0;
        const w = taskWeight(Number(row.priority), weightByPriority) * count;
        bucket.totalWeight += w;
        if (t.DONE_STATUSES.includes(status)) bucket.doneWeight += w;
    }
    return bucket;
}

function mergeBuckets(...buckets) {
    return buckets.reduce(
        (acc, b) => ({
            doneWeight: acc.doneWeight + b.doneWeight,
            totalWeight: acc.totalWeight + b.totalWeight,
        }),
        { doneWeight: 0, totalWeight: 0 }
    );
}

/**
 * Batched task aggregation.
 * @returns {{ byProject: Map<number, object[]>, directRows: object[] }}
 */
async function loadTaskRows(projectIds, goalId) {
    const byProject = new Map();

    if (projectIds.length > 0) {
        const rows = await Task.findAll({
            where: {
                project_id: { [Op.in]: projectIds },
                parent_task_id: null,
            },
            attributes: [
                'project_id',
                'status',
                'priority',
                [fn('COUNT', col('id')), 'count'],
            ],
            group: ['project_id', 'status', 'priority'],
            raw: true,
        });
        for (const row of rows) {
            const list = byProject.get(row.project_id) || [];
            list.push(row);
            byProject.set(row.project_id, list);
        }
    }

    const directRows = await Task.findAll({
        where: { goal_id: goalId, project_id: null, parent_task_id: null },
        attributes: ['status', 'priority', [fn('COUNT', col('id')), 'count']],
        group: ['status', 'priority'],
        raw: true,
    });

    return { byProject, directRows };
}

/** Map of projectId -> { percent, bucket } for the given projects. */
function projectPercents(projectIds, byProject, weightByPriority) {
    const out = new Map();
    for (const pid of projectIds) {
        const bucket = foldBucket(byProject.get(pid) || [], weightByPriority);
        out.set(pid, { percent: math.taskBucketPercent(bucket), bucket });
    }
    return out;
}

function metricPercent(keyResults) {
    return math.aggregateKeyResults(keyResults);
}

function milestonePercent(milestones) {
    return math.milestonePercent(milestones);
}

/**
 * Compute a rollup percent for a set of linked projects + an optional direct
 * task bucket, honouring one of the rollup_* / metric / milestones / manual
 * modes.
 */
function computeByMode({
    mode,
    manualPercent,
    linkedProjectIds,
    projectPct,
    directBucket,
    keyResults,
    milestones,
}) {
    switch (mode) {
        case 'manual':
            return manualPercent == null ? null : math.clamp(manualPercent);

        case 'metric':
            return metricPercent(keyResults);

        case 'milestones':
            return milestonePercent(milestones);

        case 'rollup_tasks': {
            const buckets = linkedProjectIds.map(
                (pid) => projectPct.get(pid).bucket
            );
            if (directBucket) buckets.push(directBucket);
            return math.taskBucketPercent(mergeBuckets(...buckets));
        }

        case 'rollup_projects':
        default: {
            const items = linkedProjectIds.map((pid) => {
                const { percent, bucket } = projectPct.get(pid);
                return {
                    value: percent,
                    weight: Math.max(bucket.totalWeight, 1),
                };
            });
            if (directBucket && directBucket.totalWeight > 0) {
                items.push({
                    value: math.taskBucketPercent(directBucket),
                    weight: directBucket.totalWeight,
                });
            }
            return math.weightedAverage(items);
        }
    }
}

/* ---------------------------------------------------------------- strategy */

async function keyResultsFor(parentType, parentIds) {
    if (parentIds.length === 0) return new Map();
    const rows = await GoalshqKeyResult.findAll({
        where: { parent_type: parentType, parent_id: { [Op.in]: parentIds } },
        order: [['sort_order', 'ASC']],
    });
    const map = new Map();
    for (const kr of rows) {
        const list = map.get(kr.parent_id) || [];
        list.push(kr);
        map.set(kr.parent_id, list);
    }
    return map;
}

async function milestonesFor(parentType, parentIds) {
    if (parentIds.length === 0) return new Map();
    const rows = await GoalshqMilestone.findAll({
        where: { parent_type: parentType, parent_id: { [Op.in]: parentIds } },
        order: [['sort_order', 'ASC']],
    });
    const map = new Map();
    for (const m of rows) {
        const list = map.get(m.parent_id) || [];
        list.push(m);
        map.set(m.parent_id, list);
    }
    return map;
}

async function upsertSnapshot(
    { parentType, parentId, userId, date, percent, health, source },
    transaction
) {
    const existing = await GoalshqProgressSnapshot.findOne({
        where: {
            parent_type: parentType,
            parent_id: parentId,
            snapshot_date: date,
        },
        transaction,
    });
    if (existing) {
        return existing.update({ percent, health, source }, { transaction });
    }
    return GoalshqProgressSnapshot.create(
        {
            parent_type: parentType,
            parent_id: parentId,
            user_id: userId,
            snapshot_date: date,
            percent,
            health,
            source,
        },
        { transaction }
    );
}

/* -------------------------------------------------------------------- goal */

/**
 * Recompute a single goal (and cascade to its strategies + projects).
 * @param {number} goalId
 * @param {{ source?: string }} [opts]
 * @returns {Promise<object|null>} the assembled rollup, or null if the goal is gone
 */
async function recomputeGoal(goalId, opts = {}) {
    if (inFlight.has(goalId)) return null;
    inFlight.add(goalId);
    const startedAt = Date.now();
    const source = opts.source || 'cron';

    try {
        const goal = await Goal.findByPk(goalId);
        if (!goal) return null;
        const userId = goal.user_id;

        const [user, settings, strategies] = await Promise.all([
            User.findByPk(userId),
            ensureSettings(goalId, userId),
            GoalshqStrategy.findAll({
                where: { goal_id: goalId, user_id: userId },
                order: [
                    ['sort_order', 'ASC'],
                    ['id', 'ASC'],
                ],
            }),
        ]);

        const today = t.todayInUserTz(user);
        const strategyIds = strategies.map((s) => s.id);

        // strategy -> linked project ids
        const links = await GoalshqProjectStrategy.findAll({
            where: { strategy_id: { [Op.in]: strategyIds }, user_id: userId },
        });
        const linkedByStrategy = new Map();
        const linkedProjectIds = new Set();
        for (const link of links) {
            const list = linkedByStrategy.get(link.strategy_id) || [];
            list.push(link);
            linkedByStrategy.set(link.strategy_id, list);
            linkedProjectIds.add(link.project_id);
        }

        // direct projects: goal_id === goalId and not linked to any strategy
        const directProjects = await Project.findAll({
            where: {
                goal_id: goalId,
                user_id: userId,
                ...(linkedProjectIds.size > 0
                    ? { id: { [Op.notIn]: [...linkedProjectIds] } }
                    : {}),
            },
            attributes: ['id'],
        });
        const directProjectIds = directProjects.map((p) => p.id);

        // one batched task load across everything relevant
        const allProjectIds = [...linkedProjectIds, ...directProjectIds];
        const { byProject, directRows } = await loadTaskRows(
            allProjectIds,
            goalId
        );

        const krByStrategy = await keyResultsFor('strategy', strategyIds);
        const msByStrategy = await milestonesFor('strategy', strategyIds);
        const [goalKrs, goalMilestones] = await Promise.all([
            GoalshqKeyResult.findAll({
                where: { parent_type: 'goal', parent_id: goalId },
                order: [['sort_order', 'ASC']],
            }),
            GoalshqMilestone.findAll({
                where: { parent_type: 'goal', parent_id: goalId },
                order: [['sort_order', 'ASC']],
            }),
        ]);

        // --- compute strategies -------------------------------------------
        const strategyResults = strategies.map((strategy) => {
            const strategyLinks = linkedByStrategy.get(strategy.id) || [];
            const pids = strategyLinks.map((l) => l.project_id);
            const pct = projectPercents(
                pids,
                byProject,
                strategy.weight_by_priority
            );
            const percent = computeByMode({
                mode: strategy.progress_mode,
                manualPercent: strategy.manual_percent,
                linkedProjectIds: pids,
                projectPct: pct,
                directBucket: null,
                keyResults: krByStrategy.get(strategy.id) || [],
                milestones: msByStrategy.get(strategy.id) || [],
            });
            const health = math.health(
                percent,
                strategy.start_date,
                strategy.target_date,
                today
            );
            return {
                strategy,
                percent,
                health,
                projectBreakdown: pids.map((pid) => ({
                    project_id: pid,
                    percent: pct.get(pid).percent,
                })),
            };
        });

        // --- direct bucket (unlinked projects + no-project goal tasks) ----
        const directProjectPct = projectPercents(
            directProjectIds,
            byProject,
            settings.weight_by_priority
        );
        const directProjectBuckets = directProjectIds.map(
            (pid) => directProjectPct.get(pid).bucket
        );
        const directTaskBucket = foldBucket(
            directRows,
            settings.weight_by_priority
        );
        const directBucket = mergeBuckets(
            ...directProjectBuckets,
            directTaskBucket
        );

        // --- compute goal ------------------------------------------------
        let goalPercent;
        if (settings.progress_mode === 'rollup_strategies') {
            const items = strategyResults.map((r) => ({
                value: r.percent,
                weight: r.strategy.importance || DEFAULT_IMPORTANCE,
            }));
            if (directBucket.totalWeight > 0) {
                items.push({
                    value: math.taskBucketPercent(directBucket),
                    weight: DEFAULT_IMPORTANCE,
                });
            }
            goalPercent = math.weightedAverage(items);
        } else {
            goalPercent = computeByMode({
                mode: settings.progress_mode,
                manualPercent: settings.manual_percent,
                linkedProjectIds: allProjectIds,
                projectPct: projectPercents(
                    allProjectIds,
                    byProject,
                    settings.weight_by_priority
                ),
                directBucket: directTaskBucket,
                keyResults: goalKrs,
                milestones: goalMilestones,
            });
        }

        const goalStart = settings.start_date || goal.created_at;
        const goalHealth = math.health(
            goalPercent,
            goalStart,
            goal.target_date,
            today
        );

        // --- persist ---------------------------------------------------
        await t.sequelize.transaction(async (transaction) => {
            const now = new Date();
            for (const r of strategyResults) {
                await r.strategy.update(
                    {
                        cached_percent: r.percent,
                        cached_health: r.health,
                        cached_computed_at: now,
                    },
                    { transaction }
                );
                await upsertSnapshot(
                    {
                        parentType: 'strategy',
                        parentId: r.strategy.id,
                        userId,
                        date: today,
                        percent: r.percent,
                        health: r.health,
                        source,
                    },
                    transaction
                );
            }
            await settings.update(
                {
                    cached_percent: goalPercent,
                    cached_health: goalHealth,
                    cached_computed_at: now,
                },
                { transaction }
            );
            await upsertSnapshot(
                {
                    parentType: 'goal',
                    parentId: goalId,
                    userId,
                    date: today,
                    percent: goalPercent,
                    health: goalHealth,
                    source,
                },
                transaction
            );
        });

        logService.logInfo(
            `[goalshq] recomputed goal ${goalId} (user ${userId}): ` +
                `${strategyResults.length} strategies, ` +
                `${allProjectIds.length} projects, ${Date.now() - startedAt}ms`
        );

        return {
            goal,
            settings,
            percent: goalPercent,
            health: goalHealth,
            strategies: strategyResults,
            directBucket,
        };
    } catch (err) {
        logService.logError(
            `[goalshq] recomputeGoal(${goalId}) failed: ${err.message}`,
            err
        );
        throw err;
    } finally {
        inFlight.delete(goalId);
    }
}

async function ensureSettings(goalId, userId) {
    const [settings] = await GoalshqGoalSettings.findOrCreate({
        where: { goal_id: goalId },
        defaults: { goal_id: goalId, user_id: userId },
    });
    return settings;
}

/** Recompute every goal the user owns. */
async function recomputeAllForUser(userId) {
    const goals = await Goal.findAll({
        where: { user_id: userId },
        attributes: ['id'],
    });
    for (const g of goals) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeGoal(g.id, { source: 'cron' });
    }
    return goals.length;
}

/**
 * Recompute goals whose cached settings row is older than `maxAgeMinutes`
 * (or has never been computed). Used by the cron sweep and recompute-on-read.
 */
async function recomputeStale(maxAgeMinutes, opts = {}) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const stale = await GoalshqGoalSettings.findAll({
        where: {
            [Op.or]: [
                { cached_computed_at: null },
                { cached_computed_at: { [Op.lt]: cutoff } },
            ],
        },
        attributes: ['goal_id'],
        limit: opts.limit || 500,
    });
    for (const s of stale) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeGoal(s.goal_id, { source: opts.source || 'cron' });
    }
    return stale.length;
}

/** Hard-delete GoalsHQ rows whose core parent has been gone for a while. */
async function gcOrphans() {
    const liveGoalIds = new Set(
        (await Goal.findAll({ attributes: ['id'] })).map((g) => g.id)
    );
    const liveProjectIds = new Set(
        (await Project.findAll({ attributes: ['id'] })).map((p) => p.id)
    );

    const orphanStrategies = (
        await GoalshqStrategy.findAll({ attributes: ['id', 'goal_id'] })
    )
        .filter((s) => !liveGoalIds.has(s.goal_id))
        .map((s) => s.id);

    let removed = 0;
    if (orphanStrategies.length > 0) {
        removed += await GoalshqStrategy.destroy({
            where: { id: { [Op.in]: orphanStrategies } },
        });
        await GoalshqProjectStrategy.destroy({
            where: { strategy_id: { [Op.in]: orphanStrategies } },
        });
    }

    const orphanLinks = (
        await GoalshqProjectStrategy.findAll({
            attributes: ['id', 'project_id'],
        })
    )
        .filter((l) => !liveProjectIds.has(l.project_id))
        .map((l) => l.id);
    if (orphanLinks.length > 0) {
        removed += await GoalshqProjectStrategy.destroy({
            where: { id: { [Op.in]: orphanLinks } },
        });
    }

    const orphanSettings = (
        await GoalshqGoalSettings.findAll({ attributes: ['id', 'goal_id'] })
    )
        .filter((s) => !liveGoalIds.has(s.goal_id))
        .map((s) => s.id);
    if (orphanSettings.length > 0) {
        removed += await GoalshqGoalSettings.destroy({
            where: { id: { [Op.in]: orphanSettings } },
        });
    }

    if (removed > 0) {
        logService.logInfo(`[goalshq] gcOrphans removed ${removed} rows`);
    }
    return removed;
}

module.exports = {
    recomputeGoal,
    recomputeAllForUser,
    recomputeStale,
    gcOrphans,
    ensureSettings,
    // exported for unit tests
    _internals: {
        foldBucket,
        mergeBuckets,
        projectPercents,
        computeByMode,
    },
};
