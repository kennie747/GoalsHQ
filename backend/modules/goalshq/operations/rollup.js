'use strict';

/**
 * GoalsHQ progress rollup engine.
 *
 * Two independent numbers per Goal and per Project:
 *   - EXECUTION %  — task completion, always computed
 *       chain: task bucket → project % → goal %
 *   - OUTCOME %    — Key Results / Milestones, only when `metrics_enabled`
 *
 * They are shown side by side and NEVER blended.
 *
 * Strategy is a grouping bucket, NOT part of the goal chain. Its cached number
 * is a *grouping summary* only: the unweighted mean of its linked projects'
 * execution %, with a health = worst health among those projects. It never
 * feeds the goal's execution %.
 *
 * All task counting is done with batched GROUP BY queries, never per-entity
 * loops. Writes cached_* / snapshots inside one transaction.
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
    GoalshqKeyResultEntry,
    GoalshqMilestone,
    GoalshqMilestoneTask,
    GoalshqProgressSnapshot,
    GoalshqRecord,
} = require('../../../models');
const logService = require('../../../services/logService');
const {
    getCurrentDateInTimezone,
    getSafeTimezone,
} = require('../../../utils/timezone-utils');
const { DONE_STATUSES, EXCLUDED_STATUSES } = require('./task-status');
const math = require('./progress-math');
const aggregate = require('./aggregate');

/** Current calendar date (YYYY-MM-DD) in the user's timezone. */
function todayInUserTz(user) {
    return getCurrentDateInTimezone(getSafeTimezone(user && user.timezone));
}

// Per-process guard so the cron sweep and a recompute-on-read request don't
// stampede the same goal / strategy. Keyed by "goal:<id>" / "strategy:<id>".
const inFlight = new Set();

/* ------------------------------------------------------------------ helpers */

function taskWeight(priority, weightByPriority) {
    return weightByPriority ? 1 + (priority || 0) : 1;
}

/** Fold GROUP BY (status, priority, count) rows into {doneWeight,totalWeight}. */
function foldBucket(rows, weightByPriority) {
    const bucket = { doneWeight: 0, totalWeight: 0 };
    for (const row of rows || []) {
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
 * Auto-set current_value on every KR in `keyResults` whose auto_source is
 * 'tasks_done_count' to `doneCount` — mutates in place so this same pass's
 * outcome computation sees the fresh value; pushes {id, current_value} onto
 * `changed` for a later batched persist.
 */
function applyAutoSource(keyResults, doneCount, changed) {
    for (const kr of keyResults || []) {
        if (kr.auto_source !== 'tasks_done_count') continue;
        if (kr.current_value === doneCount) continue;
        kr.current_value = doneCount;
        changed.push({ id: kr.id, current_value: doneCount });
    }
}

/**
 * Recompute `current_value` for every KR in `allKrs` (model instances), in
 * topological order (leaves before `child_kr_sum` rollups). Mutates in place so
 * this pass's outcome computation sees fresh values; returns the changed set
 * for a batched persist.
 *
 * @param {object[]} allKrs
 * @param {Map<number,number>} doneCountByKrId  scope done-task count per KR
 * @param {Map<number,{sum:number,count:number}>} recordTotals
 */
function refreshKeyResults(allKrs, doneCountByKrId, recordTotals) {
    const byId = new Map(allKrs.map((kr) => [kr.id, kr]));
    const changed = [];
    const done = new Set();

    const resolve = (kr, guard) => {
        if (done.has(kr.id)) return;
        if (guard.has(kr.id)) {
            // cycle — treat as a leaf, leave value untouched
            done.add(kr.id);
            return;
        }
        guard.add(kr.id);

        let next = kr.current_value;
        switch (kr.auto_source) {
            case 'tasks_done_count':
                next = doneCountByKrId.get(kr.id) ?? 0;
                break;
            case 'record_sum':
                next = recordTotals.get(kr.id)?.sum ?? 0;
                break;
            case 'record_count':
                next = recordTotals.get(kr.id)?.count ?? 0;
                break;
            case 'child_kr_sum': {
                const children = allKrs.filter((c) => c.parent_kr_id === kr.id);
                for (const c of children) resolve(c, guard);
                next = children.reduce(
                    (acc, c) => acc + Number(c.current_value || 0),
                    0
                );
                break;
            }
            default: // manual
                break;
        }
        guard.delete(kr.id);
        done.add(kr.id);
        if (Number(next) !== Number(kr.current_value)) {
            kr.current_value = Number(next);
            changed.push({ id: kr.id, current_value: Number(next) });
        }
    };

    for (const kr of allKrs) resolve(kr, new Set());
    void byId;
    return changed;
}

/**
 * Auto-flip `pending` milestones to `achieved` when their linked tasks satisfy
 * `completion_mode` ('all'/'any') or a linked KR crosses its threshold.
 * @returns {number[]} ids of milestones that were flipped
 */
function evaluateMilestoneTriggers(
    milestones,
    taskLinksByMilestone,
    doneTaskIds,
    krById
) {
    const achieved = [];
    for (const m of milestones) {
        if (m.status !== 'pending') continue;
        let hit = false;

        const links = taskLinksByMilestone.get(m.id) || [];
        if (links.length > 0) {
            const doneCount = links.filter((tid) =>
                doneTaskIds.has(tid)
            ).length;
            hit =
                (m.completion_mode === 'any' && doneCount >= 1) ||
                (m.completion_mode !== 'any' && doneCount === links.length);
        }

        if (!hit && m.auto_kr_id) {
            const kr = krById.get(m.auto_kr_id);
            if (kr) {
                const threshold =
                    m.auto_kr_threshold != null
                        ? m.auto_kr_threshold
                        : m.target_value != null
                          ? m.target_value
                          : kr.target_value;
                if (Number(kr.current_value) >= Number(threshold)) hit = true;
            }
        }

        if (hit) achieved.push(m.id);
    }
    return achieved;
}

/** Rank healths so we can take the "worst" of a set. */
const HEALTH_RANK = { off_track: 3, at_risk: 2, on_track: 1, no_data: 0 };
function worstHealth(healths) {
    let worst = null;
    for (const h of healths) {
        if (!h || h === 'no_data') continue;
        if (worst == null || HEALTH_RANK[h] > HEALTH_RANK[worst]) worst = h;
    }
    return worst || 'no_data';
}

/**
 * Batched task aggregation.
 * @returns {{ byProject: Map<number, object[]>, directRows: object[] }}
 */
async function loadTaskRows(projectIds, goalId) {
    const byProject = new Map();

    if (projectIds.length > 0) {
        const rows = await Task.findAll({
            where: { project_id: { [Op.in]: projectIds } },
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

    let directRows = [];
    if (goalId != null) {
        directRows = await Task.findAll({
            where: { goal_id: goalId, project_id: null },
            attributes: [
                'status',
                'priority',
                [fn('COUNT', col('id')), 'count'],
            ],
            group: ['status', 'priority'],
            raw: true,
        });
    }

    return { byProject, directRows };
}

async function keyResultsFor(parentType, parentIds) {
    if (!parentIds || parentIds.length === 0) return new Map();
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
    if (!parentIds || parentIds.length === 0) return new Map();
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
    { parentType, parentId, kind, userId, date, percent, health, source },
    transaction
) {
    const where = {
        parent_type: parentType,
        parent_id: parentId,
        kind,
        snapshot_date: date,
    };
    const existing = await GoalshqProgressSnapshot.findOne({
        where,
        transaction,
    });
    if (existing) {
        return existing.update({ percent, health, source }, { transaction });
    }
    return GoalshqProgressSnapshot.create(
        { ...where, user_id: userId, percent, health, source },
        { transaction }
    );
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

/* --------------------------------------------------------- project compute */

/**
 * Compute {executionPercent, executionHealth, outcomePercent, outcomeHealth}
 * for a set of projects, given their batched task rows + settings + KRs/ms.
 * Returns Map<projectId, {...}>.
 */
function computeProjects({
    projectIds,
    projectRowById,
    byProject,
    settingsByProject,
    krByProject,
    msByProject,
    today,
}) {
    const out = new Map();
    for (const pid of projectIds) {
        const settings = settingsByProject.get(pid);
        const bucket = foldBucket(byProject.get(pid) || [], false);
        let execution =
            settings && settings.manual_percent != null
                ? math.clamp(settings.manual_percent)
                : math.taskBucketPercent(bucket);
        const row = projectRowById.get(pid);
        const executionHealth = math.health(
            execution,
            row ? row.created_at : null,
            row ? row.due_date_at : null,
            today
        );

        let outcome = null;
        let outcomeHealth = 'no_data';
        if (settings && settings.metrics_enabled) {
            outcome = math.outcomePercent(
                krByProject.get(pid) || [],
                msByProject.get(pid) || []
            );
            outcomeHealth = math.health(
                outcome,
                row ? row.created_at : null,
                row ? row.due_date_at : null,
                today
            );
        }

        out.set(pid, {
            projectId: pid,
            bucket,
            execution,
            executionHealth,
            outcome,
            outcomeHealth,
            settings,
        });
    }
    return out;
}

/* -------------------------------------------------------------------- goal */

/**
 * Recompute a single goal: its execution % and outcome %, its projects, and
 * the grouping summary of every strategy attached to it.
 * @returns {Promise<object|null>} null if the goal is gone
 */
async function recomputeGoal(goalId, opts = {}) {
    const key = `goal:${goalId}`;
    if (inFlight.has(key)) return null;
    inFlight.add(key);
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
        const links = strategyIds.length
            ? await GoalshqProjectStrategy.findAll({
                  where: {
                      strategy_id: { [Op.in]: strategyIds },
                      user_id: userId,
                  },
              })
            : [];
        const linkedByStrategy = new Map();
        const linkedProjectIds = new Set();
        for (const link of links) {
            const list = linkedByStrategy.get(link.strategy_id) || [];
            list.push(link.project_id);
            linkedByStrategy.set(link.strategy_id, list);
            linkedProjectIds.add(link.project_id);
        }

        // Every project that belongs to this goal (strategy grouping is
        // irrelevant to the goal number now).
        const goalProjects = await Project.findAll({
            where: { goal_id: goalId, user_id: userId },
            attributes: ['id', 'due_date_at', 'created_at'],
        });
        const goalProjectIds = goalProjects.map((p) => p.id);

        // Union: goal's own projects + any project linked to one of its
        // strategies (needed for that strategy's grouping summary).
        const allProjectIds = [
            ...new Set([...goalProjectIds, ...linkedProjectIds]),
        ];

        const { byProject, directRows } = await loadTaskRows(
            allProjectIds,
            goalId
        );

        const [
            projectRows,
            existingProjectSettings,
            krByProject,
            msByProject,
            goalKrs,
            goalMilestones,
            krByStrategy,
        ] = await Promise.all([
            Project.findAll({
                where: { id: { [Op.in]: allProjectIds } },
                attributes: ['id', 'due_date_at', 'created_at'],
            }),
            GoalshqProjectSettings.findAll({
                where: { project_id: { [Op.in]: allProjectIds } },
            }),
            keyResultsFor('project', allProjectIds),
            milestonesFor('project', allProjectIds),
            GoalshqKeyResult.findAll({
                where: { parent_type: 'goal', parent_id: goalId },
                order: [['sort_order', 'ASC']],
            }),
            GoalshqMilestone.findAll({
                where: { parent_type: 'goal', parent_id: goalId },
                order: [['sort_order', 'ASC']],
            }),
            keyResultsFor('strategy', strategyIds),
        ]);
        const msByStrategy = await milestonesFor('strategy', strategyIds);
        const strategyMs = [...msByStrategy.values()].flat();

        const projectRowById = new Map(projectRows.map((p) => [p.id, p]));
        const settingsByProject = new Map(
            existingProjectSettings.map((s) => [s.project_id, s])
        );
        const missing = allProjectIds.filter((p) => !settingsByProject.has(p));
        if (missing.length > 0) {
            const created = await GoalshqProjectSettings.bulkCreate(
                missing.map((project_id) => ({ project_id, user_id: userId }))
            );
            for (const row of created)
                settingsByProject.set(row.project_id, row);
        }

        // --- refresh every KR in scope (auto_source + KR tree) ---------------
        const projectKrs = [...krByProject.values()].flat();
        const strategyKrs = [...krByStrategy.values()].flat();
        const allKrs = [...goalKrs, ...projectKrs, ...strategyKrs];
        const doneCountByKrId = new Map();
        const goalDoneCount =
            goalProjectIds.reduce(
                (acc, pid) => acc + countDoneRows(byProject.get(pid)),
                0
            ) + countDoneRows(directRows);
        for (const kr of goalKrs) doneCountByKrId.set(kr.id, goalDoneCount);
        for (const sid of strategyIds) {
            const pids = linkedByStrategy.get(sid) || [];
            const d = pids.reduce(
                (acc, pid) => acc + countDoneRows(byProject.get(pid)),
                0
            );
            for (const kr of krByStrategy.get(sid) || [])
                doneCountByKrId.set(kr.id, d);
        }
        for (const pid of allProjectIds) {
            const d = countDoneRows(byProject.get(pid));
            for (const kr of krByProject.get(pid) || [])
                doneCountByKrId.set(kr.id, d);
        }
        const recordTotals = await aggregate.recordTotalsByKr(
            allKrs.map((k) => k.id)
        );
        const autoKrUpdates = refreshKeyResults(
            allKrs,
            doneCountByKrId,
            recordTotals
        );

        // --- milestone auto-achieve (task links / KR threshold) -------------
        // Runs before the outcome calc so a just-achieved milestone counts.
        const allMilestones = [
            ...goalMilestones,
            ...[...msByProject.values()].flat(),
            ...strategyMs,
        ];
        const pendingMs = allMilestones.filter((m) => m.status === 'pending');
        let milestoneAchievedIds = [];
        if (pendingMs.length > 0) {
            const links = await GoalshqMilestoneTask.findAll({
                where: {
                    milestone_id: { [Op.in]: pendingMs.map((m) => m.id) },
                },
            });
            const taskLinksByMilestone = new Map();
            for (const l of links) {
                const list = taskLinksByMilestone.get(l.milestone_id) || [];
                list.push(l.task_id);
                taskLinksByMilestone.set(l.milestone_id, list);
            }
            const linkedTaskIds = [...new Set(links.map((l) => l.task_id))];
            const doneTaskIds = new Set();
            if (linkedTaskIds.length > 0) {
                const rows = await Task.findAll({
                    where: { id: { [Op.in]: linkedTaskIds } },
                    attributes: ['id', 'status'],
                    raw: true,
                });
                for (const r of rows) {
                    if (DONE_STATUSES.includes(Number(r.status)))
                        doneTaskIds.add(r.id);
                }
            }
            const krById = new Map(allKrs.map((k) => [k.id, k]));
            milestoneAchievedIds = evaluateMilestoneTriggers(
                pendingMs,
                taskLinksByMilestone,
                doneTaskIds,
                krById
            );
            const achievedNow = new Date();
            for (const m of allMilestones) {
                if (milestoneAchievedIds.includes(m.id)) {
                    m.status = 'achieved';
                    m.achieved_at = achievedNow;
                    m.auto_achieved = true;
                }
            }
        }

        const projectResults = computeProjects({
            projectIds: allProjectIds,
            projectRowById,
            byProject,
            settingsByProject,
            krByProject,
            msByProject,
            today,
        });

        // --- goal execution % ------------------------------------------------
        const goalStart = settings.start_date || goal.created_at;
        const items = goalProjectIds.map((pid) => {
            const r = projectResults.get(pid);
            return {
                value: r.execution,
                weight: Math.max(r.bucket.totalWeight, 1),
            };
        });
        const directBucket = foldBucket(directRows, false);
        if (directBucket.totalWeight > 0) {
            items.push({
                value: math.taskBucketPercent(directBucket),
                weight: directBucket.totalWeight,
            });
        }
        let goalExecution =
            settings.manual_percent != null
                ? math.clamp(settings.manual_percent)
                : math.weightedAverage(items);
        const goalExecutionHealth = math.health(
            goalExecution,
            goalStart,
            goal.target_date,
            today
        );

        // --- goal outcome % ------------------------------------------------
        let goalOutcome = null;
        let goalOutcomeHealth = 'no_data';
        if (settings.metrics_enabled) {
            goalOutcome = math.outcomePercent(goalKrs, goalMilestones);
            goalOutcomeHealth = math.health(
                goalOutcome,
                goalStart,
                goal.target_date,
                today
            );
        }

        // --- strategy grouping summaries ----------------------------------
        const strategyResults = strategies.map((strategy) => {
            const pids = linkedByStrategy.get(strategy.id) || [];
            const execs = pids.map((pid) => projectResults.get(pid)?.execution);
            const healths = pids.map(
                (pid) => projectResults.get(pid)?.executionHealth
            );
            return {
                strategy,
                percent: math.mean(execs),
                health: worstHealth(healths),
            };
        });

        // --- persist ------------------------------------------------------
        await sequelize.transaction(async (transaction) => {
            const now = new Date();

            await settings.update(
                {
                    cached_execution_percent: goalExecution,
                    cached_execution_health: goalExecutionHealth,
                    cached_outcome_percent: goalOutcome,
                    cached_outcome_health: goalOutcomeHealth,
                    cached_computed_at: now,
                },
                { transaction }
            );
            await upsertSnapshot(
                {
                    parentType: 'goal',
                    parentId: goalId,
                    kind: 'execution',
                    userId,
                    date: today,
                    percent: goalExecution,
                    health: goalExecutionHealth,
                    source,
                },
                transaction
            );
            if (settings.metrics_enabled) {
                await upsertSnapshot(
                    {
                        parentType: 'goal',
                        parentId: goalId,
                        kind: 'outcome',
                        userId,
                        date: today,
                        percent: goalOutcome,
                        health: goalOutcomeHealth,
                        source,
                    },
                    transaction
                );
            }

            if (allProjectIds.length > 0) {
                await GoalshqProjectSettings.bulkCreate(
                    allProjectIds.map((pid) => {
                        const r = projectResults.get(pid);
                        return {
                            project_id: pid,
                            user_id: userId,
                            metrics_enabled: !!(
                                r.settings && r.settings.metrics_enabled
                            ),
                            cached_execution_percent: r.execution,
                            cached_execution_health: r.executionHealth,
                            cached_outcome_percent: r.outcome,
                            cached_outcome_health: r.outcomeHealth,
                            cached_computed_at: now,
                        };
                    }),
                    {
                        updateOnDuplicate: [
                            'cached_execution_percent',
                            'cached_execution_health',
                            'cached_outcome_percent',
                            'cached_outcome_health',
                            'cached_computed_at',
                        ],
                        transaction,
                    }
                );
                for (const pid of allProjectIds) {
                    const r = projectResults.get(pid);
                    await upsertSnapshot(
                        {
                            parentType: 'project',
                            parentId: pid,
                            kind: 'execution',
                            userId,
                            date: today,
                            percent: r.execution,
                            health: r.executionHealth,
                            source,
                        },
                        transaction
                    );
                    if (r.settings && r.settings.metrics_enabled) {
                        await upsertSnapshot(
                            {
                                parentType: 'project',
                                parentId: pid,
                                kind: 'outcome',
                                userId,
                                date: today,
                                percent: r.outcome,
                                health: r.outcomeHealth,
                                source,
                            },
                            transaction
                        );
                    }
                }
            }

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
                        kind: 'execution',
                        userId,
                        date: today,
                        percent: r.percent,
                        health: r.health,
                        source,
                    },
                    transaction
                );
            }

            for (const u of autoKrUpdates) {
                // eslint-disable-next-line no-await-in-loop
                await GoalshqKeyResult.update(
                    { current_value: u.current_value },
                    { where: { id: u.id }, transaction }
                );
            }

            if (milestoneAchievedIds.length > 0) {
                await GoalshqMilestone.update(
                    {
                        status: 'achieved',
                        achieved_at: new Date(),
                        auto_achieved: true,
                    },
                    {
                        where: { id: { [Op.in]: milestoneAchievedIds } },
                        transaction,
                    }
                );
            }
        });

        logService.logInfo(
            `[goalshq] recomputed goal ${goalId} (user ${userId}): ` +
                `exec ${goalExecution ?? '—'}%, ` +
                `${strategyResults.length} strategies, ` +
                `${allProjectIds.length} projects, ${Date.now() - startedAt}ms`
        );

        return {
            goal,
            settings,
            execution: goalExecution,
            outcome: goalOutcome,
            strategies: strategyResults,
        };
    } catch (err) {
        logService.logError(
            `[goalshq] recomputeGoal(${goalId}) failed: ${err.message}`,
            err
        );
        throw err;
    } finally {
        inFlight.delete(key);
    }
}

/* --------------------------------------------------------------- strategy */

/**
 * Recompute a single strategy's grouping summary. Only needed on its own for
 * a goal-less strategy — a strategy under a goal is recomputed by recomputeGoal.
 */
async function recomputeStrategy(strategyId, opts = {}) {
    const key = `strategy:${strategyId}`;
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    const source = opts.source || 'cron';
    try {
        const strategy = await GoalshqStrategy.findByPk(strategyId);
        if (!strategy) return null;
        // Under a goal → let recomputeGoal own it.
        if (strategy.goal_id != null) {
            return recomputeGoal(strategy.goal_id, opts);
        }
        const userId = strategy.user_id;
        const [user, links, krs] = await Promise.all([
            User.findByPk(userId),
            GoalshqProjectStrategy.findAll({
                where: { strategy_id: strategyId, user_id: userId },
            }),
            GoalshqKeyResult.findAll({
                where: { parent_type: 'strategy', parent_id: strategyId },
            }),
        ]);
        const today = todayInUserTz(user);
        const projectIds = links.map((l) => l.project_id);
        const { byProject } = await loadTaskRows(projectIds, null);
        const projectRows = await Project.findAll({
            where: { id: { [Op.in]: projectIds } },
            attributes: ['id', 'due_date_at', 'created_at'],
        });
        const projectRowById = new Map(projectRows.map((p) => [p.id, p]));

        const execs = [];
        const healths = [];
        const autoKrUpdates = [];
        let doneCount = 0;
        for (const pid of projectIds) {
            const bucket = foldBucket(byProject.get(pid) || [], false);
            const pct = math.taskBucketPercent(bucket);
            execs.push(pct);
            const row = projectRowById.get(pid);
            healths.push(
                math.health(
                    pct,
                    row ? row.created_at : null,
                    row ? row.due_date_at : null,
                    today
                )
            );
            doneCount += countDoneRows(byProject.get(pid));
        }
        {
            const totals = await aggregate.recordTotalsByKr(
                krs.map((k) => k.id)
            );
            const dc = new Map(krs.map((k) => [k.id, doneCount]));
            autoKrUpdates.push(...refreshKeyResults(krs, dc, totals));
        }

        const percent = math.mean(execs);
        const health = worstHealth(healths);

        await sequelize.transaction(async (transaction) => {
            const now = new Date();
            await strategy.update(
                {
                    cached_percent: percent,
                    cached_health: health,
                    cached_computed_at: now,
                },
                { transaction }
            );
            await upsertSnapshot(
                {
                    parentType: 'strategy',
                    parentId: strategyId,
                    kind: 'execution',
                    userId,
                    date: today,
                    percent,
                    health,
                    source,
                },
                transaction
            );
            for (const u of autoKrUpdates) {
                // eslint-disable-next-line no-await-in-loop
                await GoalshqKeyResult.update(
                    { current_value: u.current_value },
                    { where: { id: u.id }, transaction }
                );
            }
        });

        return { strategy, percent, health };
    } catch (err) {
        logService.logError(
            `[goalshq] recomputeStrategy(${strategyId}) failed: ${err.message}`,
            err
        );
        throw err;
    } finally {
        inFlight.delete(key);
    }
}

/* ---------------------------------------------------------------- project */

/**
 * Recompute a single project's execution + outcome caches. Delegates to
 * recomputeGoal when the project belongs to a goal (that pass owns project
 * caches); only does standalone work for a goal-less project.
 */
async function recomputeProject(projectId, opts = {}) {
    const project = await Project.findByPk(projectId);
    if (!project) return null;
    if (project.goal_id != null) {
        return recomputeGoal(project.goal_id, opts);
    }
    const key = `project:${projectId}`;
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    const source = opts.source || 'cron';
    try {
        const userId = project.user_id;
        const [user, settings, krs, milestones] = await Promise.all([
            User.findByPk(userId),
            ensureProjectSettings(projectId, userId),
            GoalshqKeyResult.findAll({
                where: { parent_type: 'project', parent_id: projectId },
            }),
            GoalshqMilestone.findAll({
                where: { parent_type: 'project', parent_id: projectId },
            }),
        ]);
        const today = todayInUserTz(user);
        const { byProject } = await loadTaskRows([projectId], null);
        const bucket = foldBucket(byProject.get(projectId) || [], false);
        const doneCount = countDoneRows(byProject.get(projectId));

        const autoKrUpdates = [];
        {
            const totals = await aggregate.recordTotalsByKr(
                krs.map((k) => k.id)
            );
            const dc = new Map(krs.map((k) => [k.id, doneCount]));
            autoKrUpdates.push(...refreshKeyResults(krs, dc, totals));
        }

        const execution =
            settings.manual_percent != null
                ? math.clamp(settings.manual_percent)
                : math.taskBucketPercent(bucket);
        const executionHealth = math.health(
            execution,
            project.created_at,
            project.due_date_at,
            today
        );
        let outcome = null;
        let outcomeHealth = 'no_data';
        if (settings.metrics_enabled) {
            outcome = math.outcomePercent(krs, milestones);
            outcomeHealth = math.health(
                outcome,
                project.created_at,
                project.due_date_at,
                today
            );
        }

        await sequelize.transaction(async (transaction) => {
            const now = new Date();
            await settings.update(
                {
                    cached_execution_percent: execution,
                    cached_execution_health: executionHealth,
                    cached_outcome_percent: outcome,
                    cached_outcome_health: outcomeHealth,
                    cached_computed_at: now,
                },
                { transaction }
            );
            await upsertSnapshot(
                {
                    parentType: 'project',
                    parentId: projectId,
                    kind: 'execution',
                    userId,
                    date: today,
                    percent: execution,
                    health: executionHealth,
                    source,
                },
                transaction
            );
            if (settings.metrics_enabled) {
                await upsertSnapshot(
                    {
                        parentType: 'project',
                        parentId: projectId,
                        kind: 'outcome',
                        userId,
                        date: today,
                        percent: outcome,
                        health: outcomeHealth,
                        source,
                    },
                    transaction
                );
            }
            for (const u of autoKrUpdates) {
                // eslint-disable-next-line no-await-in-loop
                await GoalshqKeyResult.update(
                    { current_value: u.current_value },
                    { where: { id: u.id }, transaction }
                );
            }
        });
        return { project, execution, outcome };
    } catch (err) {
        logService.logError(
            `[goalshq] recomputeProject(${projectId}) failed: ${err.message}`,
            err
        );
        throw err;
    } finally {
        inFlight.delete(key);
    }
}

/* ----------------------------------------------------------------- sweeps */

/** Recompute every goal + every goal-less strategy the user owns. */
async function recomputeAllForUser(userId) {
    const goals = await Goal.findAll({
        where: { user_id: userId },
        attributes: ['id'],
    });
    for (const g of goals) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeGoal(g.id, { source: 'cron' });
    }
    const looseStrategies = await GoalshqStrategy.findAll({
        where: { user_id: userId, goal_id: null },
        attributes: ['id'],
    });
    for (const s of looseStrategies) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeStrategy(s.id, { source: 'cron' });
    }
    return goals.length + looseStrategies.length;
}

/**
 * Recompute goals whose cached settings row is older than `maxAgeMinutes` (or
 * has never been computed), plus goal-less strategies not computed recently.
 */
async function recomputeStale(maxAgeMinutes, opts = {}) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const staleFilter = {
        [Op.or]: [
            { cached_computed_at: null },
            { cached_computed_at: { [Op.lt]: cutoff } },
        ],
    };
    const stale = await GoalshqGoalSettings.findAll({
        where: staleFilter,
        attributes: ['goal_id'],
        limit: opts.limit || 500,
    });
    for (const s of stale) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeGoal(s.goal_id, { source: opts.source || 'cron' });
    }
    const staleStrategies = await GoalshqStrategy.findAll({
        where: { goal_id: null, ...staleFilter },
        attributes: ['id'],
        limit: opts.limit || 500,
    });
    for (const s of staleStrategies) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeStrategy(s.id, { source: opts.source || 'cron' });
    }
    return stale.length + staleStrategies.length;
}

/** Hard-delete GoalsHQ rows whose core parent has been gone for a while. */
async function gcOrphans() {
    const liveGoalIds = new Set(
        (await Goal.findAll({ attributes: ['id'] })).map((g) => g.id)
    );
    const liveProjectIds = new Set(
        (await Project.findAll({ attributes: ['id'] })).map((p) => p.id)
    );
    const liveStrategyIds = new Set(
        (await GoalshqStrategy.findAll({ attributes: ['id'] })).map((s) => s.id)
    );
    const liveTaskIds = new Set(
        (await Task.findAll({ attributes: ['id'] })).map((t) => t.id)
    );

    let removed = 0;

    // A strategy with goal_id = NULL is VALID (unassigned), not an orphan —
    // only clean up links/metrics whose project/strategy is actually gone.
    const orphanLinks = (
        await GoalshqProjectStrategy.findAll({
            attributes: ['id', 'project_id', 'strategy_id'],
        })
    )
        .filter(
            (l) =>
                !liveProjectIds.has(l.project_id) ||
                !liveStrategyIds.has(l.strategy_id)
        )
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
        GoalshqRecord,
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

    // KR check-in entries + KR trees: drop entries/child-links whose KR is gone.
    const liveKrIds = new Set(
        (await GoalshqKeyResult.findAll({ attributes: ['id'] })).map(
            (k) => k.id
        )
    );
    const orphanEntryIds = (
        await GoalshqKeyResultEntry.findAll({
            attributes: ['id', 'key_result_id'],
        })
    )
        .filter((e) => !liveKrIds.has(e.key_result_id))
        .map((e) => e.id);
    if (orphanEntryIds.length > 0) {
        removed += await GoalshqKeyResultEntry.destroy({
            where: { id: { [Op.in]: orphanEntryIds } },
        });
    }
    // A child KR whose parent_kr_id is gone becomes a plain leaf.
    await GoalshqKeyResult.update(
        { parent_kr_id: null },
        {
            where: {
                parent_kr_id: { [Op.notIn]: [...liveKrIds, 0] },
            },
        }
    );

    // Milestone task links whose milestone or task is gone.
    const liveMilestoneIds = new Set(
        (await GoalshqMilestone.findAll({ attributes: ['id'] })).map(
            (m) => m.id
        )
    );
    const orphanLinkIds = (
        await GoalshqMilestoneTask.findAll({
            attributes: ['id', 'milestone_id', 'task_id'],
        })
    )
        .filter(
            (l) =>
                !liveMilestoneIds.has(l.milestone_id) ||
                !liveTaskIds.has(l.task_id)
        )
        .map((l) => l.id);
    if (orphanLinkIds.length > 0) {
        removed += await GoalshqMilestoneTask.destroy({
            where: { id: { [Op.in]: orphanLinkIds } },
        });
    }

    if (removed > 0) {
        logService.logInfo(`[goalshq] gcOrphans removed ${removed} rows`);
    }
    return removed;
}

module.exports = {
    recomputeGoal,
    recomputeStrategy,
    recomputeProject,
    recomputeAllForUser,
    recomputeStale,
    gcOrphans,
    ensureSettings,
    ensureProjectSettings,
    _internals: {
        foldBucket,
        mergeBuckets,
        countDoneRows,
        applyAutoSource,
        worstHealth,
        computeProjects,
    },
};
