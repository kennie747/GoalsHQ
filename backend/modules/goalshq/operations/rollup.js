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

const { Op, fn, col } = require('sequelize');
const {
    sequelize,
    Goal,
    Project,
    Task,
    User,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('../../../models');
const logService = require('../../../services/logService');
const {
    getCurrentDateInTimezone,
    getSafeTimezone,
} = require('../../../utils/timezone-utils');
const { DONE_STATUSES, EXCLUDED_STATUSES } = require('./task-status');
const math = require('./progress-math');
const { DEFAULT_IMPORTANCE } = require('./constants');

/** Current calendar date (YYYY-MM-DD) in the user's timezone. */
function todayInUserTz(user) {
    return getCurrentDateInTimezone(getSafeTimezone(user && user.timezone));
}

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
        if (EXCLUDED_STATUSES.includes(status)) continue;
        const count = Number(row.count) || 0;
        const w = taskWeight(Number(row.priority), weightByPriority) * count;
        bucket.totalWeight += w;
        if (DONE_STATUSES.includes(status)) bucket.doneWeight += w;
    }
    return bucket;
}

/** Sum of `count` across GROUP BY rows whose status is a "done" status. */
function countDoneRows(rows) {
    let count = 0;
    for (const row of rows || []) {
        if (DONE_STATUSES.includes(Number(row.status))) {
            count += Number(row.count) || 0;
        }
    }
    return count;
}

/**
 * Auto-sets current_value on every KR in `keyResults` whose auto_source is
 * 'tasks_done_count' to `doneCount` — mutates the KR instances in place (so
 * the SAME pass's metric-mode percent computation sees the fresh value) and
 * pushes {id, current_value} onto `changed` for anything that actually moved,
 * for a later batched persist.
 */
function applyAutoSource(keyResults, doneCount, changed) {
    for (const kr of keyResults || []) {
        if (kr.auto_source !== 'tasks_done_count') continue;
        if (kr.current_value === doneCount) continue;
        kr.current_value = doneCount;
        changed.push({ id: kr.id, current_value: doneCount });
    }
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

    // Subtasks are counted as their own weighted units alongside top-level
    // tasks (no `parent_task_id: null` filter) — daily subtask completion is
    // real completed work and previously vanished from every rollup entirely.
    // A subtask is bucketed by whatever `project_id` it actually carries
    // (inheritance from its parent is an app-level convention on one creation
    // path only, not a guarantee — see backend/modules/tasks/operations/subtasks.js),
    // so a subtask with a null/mismatched project_id simply falls through
    // uncounted here, same as any other task would.
    if (projectIds.length > 0) {
        const rows = await Task.findAll({
            where: {
                project_id: { [Op.in]: projectIds },
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
        where: { goal_id: goalId, project_id: null },
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

        const today = todayInUserTz(user);
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

        // --- compute each project's own measurable tier -------------------
        // Every project touched by this goal gets a lazily-created settings
        // row (mirrors Goal). Default mode `rollup_tasks` reproduces the same
        // unweighted task percent as before (no behaviour change); `metric`/
        // `milestones`/`manual` compute from the project's own KRs/milestones
        // instead, and that measured percent is preferred over the raw
        // task-based one when a Strategy rolls this project up (see below).
        const [projectRows, existingProjectSettings, krByProject, msByProject] =
            await Promise.all([
                Project.findAll({
                    where: { id: { [Op.in]: allProjectIds } },
                    attributes: ['id', 'due_date_at', 'created_at'],
                }),
                GoalshqProjectSettings.findAll({
                    where: { project_id: { [Op.in]: allProjectIds } },
                }),
                keyResultsFor('project', allProjectIds),
                milestonesFor('project', allProjectIds),
            ]);
        const projectRowById = new Map(projectRows.map((p) => [p.id, p]));
        const projectSettingsMap = new Map(
            existingProjectSettings.map((s) => [s.project_id, s])
        );
        // Batch-create settings rows for any project that's never had one,
        // in a single bulkCreate — not one findOrCreate per project, which
        // fans out into concurrent competing transactions and trips
        // SQLITE_BUSY under load (this is exactly the N+1 shape
        // rollup.perf.test.js exists to catch).
        const missingProjectIds = allProjectIds.filter(
            (pid) => !projectSettingsMap.has(pid)
        );
        if (missingProjectIds.length > 0) {
            const created = await GoalshqProjectSettings.bulkCreate(
                missingProjectIds.map((pid) => ({
                    project_id: pid,
                    user_id: userId,
                }))
            );
            for (const row of created) {
                projectSettingsMap.set(row.project_id, row);
            }
        }
        const nativeProjectPct = projectPercents(
            allProjectIds,
            byProject,
            false
        );

        // --- KR automation hooks (Phase F) --------------------------------
        // A KR with auto_source: 'tasks_done_count' gets its current_value
        // auto-set from the same batched task rows already loaded above —
        // never a fresh per-KR query. Mutated in place so this same pass's
        // metric-mode percent computation (below) sees the fresh value;
        // autoKrUpdates collects the small, bounded set that actually
        // changed for a batched persist inside the transaction.
        const autoKrUpdates = [];
        const goalDoneCount =
            allProjectIds.reduce(
                (acc, pid) => acc + countDoneRows(byProject.get(pid)),
                0
            ) + countDoneRows(directRows);
        applyAutoSource(goalKrs, goalDoneCount, autoKrUpdates);
        for (const strategy of strategies) {
            const pids = (linkedByStrategy.get(strategy.id) || []).map(
                (l) => l.project_id
            );
            const doneCount = pids.reduce(
                (acc, pid) => acc + countDoneRows(byProject.get(pid)),
                0
            );
            applyAutoSource(
                krByStrategy.get(strategy.id) || [],
                doneCount,
                autoKrUpdates
            );
        }
        for (const pid of allProjectIds) {
            applyAutoSource(
                krByProject.get(pid) || [],
                countDoneRows(byProject.get(pid)),
                autoKrUpdates
            );
        }

        const projectResults = allProjectIds.map((pid) => {
            const settingsRow = projectSettingsMap.get(pid);
            const mode = settingsRow.progress_mode;
            let percent;
            switch (mode) {
                case 'metric':
                    percent = metricPercent(krByProject.get(pid) || []);
                    break;
                case 'milestones':
                    percent = milestonePercent(msByProject.get(pid) || []);
                    break;
                case 'manual':
                    percent =
                        settingsRow.manual_percent == null
                            ? null
                            : math.clamp(settingsRow.manual_percent);
                    break;
                case 'rollup_tasks':
                default:
                    percent = nativeProjectPct.get(pid).percent;
            }
            const projectRow = projectRowById.get(pid);
            const health = math.health(
                percent,
                projectRow ? projectRow.created_at : null,
                projectRow ? projectRow.due_date_at : null,
                today
            );
            return { projectId: pid, settingsRow, mode, percent, health };
        });
        // Only projects in a non-default (measured) mode override what a
        // Strategy sees as that project's contribution — default-mode
        // projects keep deferring to the strategy's own task-weighted bucket
        // exactly as before.
        const projectPercentOverride = new Map(
            projectResults
                .filter((r) => r.mode !== 'rollup_tasks')
                .map((r) => [r.projectId, r.percent])
        );

        // --- compute strategies -------------------------------------------
        const strategyResults = strategies.map((strategy) => {
            const strategyLinks = linkedByStrategy.get(strategy.id) || [];
            const pids = strategyLinks.map((l) => l.project_id);
            const pct = projectPercents(
                pids,
                byProject,
                strategy.weight_by_priority
            );
            for (const pid of pids) {
                if (projectPercentOverride.has(pid)) {
                    pct.set(pid, {
                        ...pct.get(pid),
                        percent: projectPercentOverride.get(pid),
                    });
                }
            }
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
        await sequelize.transaction(async (transaction) => {
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
            // Batch upsert every project's cache + snapshot in two queries
            // total (not a per-project loop) — a project count in the
            // hundreds must not turn into hundreds of round-trips.
            if (projectResults.length > 0) {
                await GoalshqProjectSettings.bulkCreate(
                    projectResults.map((r) => ({
                        project_id: r.projectId,
                        user_id: userId,
                        progress_mode: r.settingsRow.progress_mode,
                        importance: r.settingsRow.importance,
                        manual_percent: r.settingsRow.manual_percent,
                        cached_percent: r.percent,
                        cached_health: r.health,
                        cached_computed_at: now,
                    })),
                    {
                        updateOnDuplicate: [
                            'cached_percent',
                            'cached_health',
                            'cached_computed_at',
                        ],
                        transaction,
                    }
                );
                await GoalshqProgressSnapshot.bulkCreate(
                    projectResults.map((r) => ({
                        parent_type: 'project',
                        parent_id: r.projectId,
                        user_id: userId,
                        snapshot_date: today,
                        percent: r.percent,
                        health: r.health,
                        source,
                    })),
                    {
                        updateOnDuplicate: ['percent', 'health', 'source'],
                        transaction,
                    }
                );
            }
            // Auto-source KR updates: a small, bounded set (opt-in per KR,
            // not proportional to task count), so a per-row update matches
            // the same pattern already used for strategyResults just above
            // rather than fighting bulkCreate's INSERT-shaped validation for
            // a partial column set.
            for (const update of autoKrUpdates) {
                // eslint-disable-next-line no-await-in-loop
                await GoalshqKeyResult.update(
                    { current_value: update.current_value },
                    { where: { id: update.id }, transaction }
                );
            }
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

async function ensureProjectSettings(projectId, userId) {
    const [settings] = await GoalshqProjectSettings.findOrCreate({
        where: { project_id: projectId },
        defaults: { project_id: projectId, user_id: userId },
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

    const orphanProjectSettings = (
        await GoalshqProjectSettings.findAll({
            attributes: ['id', 'project_id'],
        })
    )
        .filter((s) => !liveProjectIds.has(s.project_id))
        .map((s) => s.id);
    if (orphanProjectSettings.length > 0) {
        removed += await GoalshqProjectSettings.destroy({
            where: { id: { [Op.in]: orphanProjectSettings } },
        });
    }

    // KeyResult/Milestone/ProgressSnapshot are polymorphic (parent_type +
    // parent_id, no DB-level FK), so they can't cascade via association even
    // with foreign_keys enforcement on — clean them up against whatever
    // goals/strategies/projects/tasks are still live now that orphaned
    // strategies are gone.
    const liveStrategyIds = new Set(
        (await GoalshqStrategy.findAll({ attributes: ['id'] })).map((s) => s.id)
    );
    const liveTaskIds = new Set(
        (await Task.findAll({ attributes: ['id'] })).map((t) => t.id)
    );
    const isOrphanParent = (row) =>
        (row.parent_type === 'goal' && !liveGoalIds.has(row.parent_id)) ||
        (row.parent_type === 'strategy' &&
            !liveStrategyIds.has(row.parent_id)) ||
        (row.parent_type === 'project' && !liveProjectIds.has(row.parent_id)) ||
        (row.parent_type === 'task' && !liveTaskIds.has(row.parent_id));

    for (const Model of [
        GoalshqKeyResult,
        GoalshqMilestone,
        GoalshqProgressSnapshot,
    ]) {
        // eslint-disable-next-line no-await-in-loop
        const orphanIds = (
            await Model.findAll({
                attributes: ['id', 'parent_type', 'parent_id'],
            })
        )
            .filter(isOrphanParent)
            .map((row) => row.id);
        if (orphanIds.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            removed += await Model.destroy({
                where: { id: { [Op.in]: orphanIds } },
            });
        }
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
    ensureProjectSettings,
    // exported for unit tests
    _internals: {
        foldBucket,
        mergeBuckets,
        projectPercents,
        computeByMode,
        countDoneRows,
        applyAutoSource,
    },
};
