import { Task } from '../entities/Task';
import { Project } from '../entities/Project';
import { GoalSummary } from '../entities/Goal';
import { GoalshqHealth } from '../entities/GoalSettings';

export type SuggestionReason =
    | 'due'
    | 'goal'
    | 'goal_at_risk'
    | 'strategy'
    | 'strategy_at_risk'
    | 'fits_now'
    | 'revive'
    | 'high'
    | 'aging_review'
    | 'next_step'
    | 'area_balance';

export interface SuggestionMeta {
    score: number;
    reason: SuggestionReason;
    reasonLabel: string;
    reasonColor: string;
}

export interface SuggestionOpts {
    balanceMode?: boolean;
    contextFilter?: string;
}

const AT_RISK_HEALTH: GoalshqHealth[] = ['at_risk', 'off_track'];
const HEALTH_RISK_RANK: Record<GoalshqHealth, number> = {
    off_track: 0,
    at_risk: 1,
    on_track: 2,
    no_data: 3,
};

/** uid -> GoalsHQ health, for the "advances an at-risk goal" scoring bonus. */
export function buildGoalHealthMap(
    goalSummaries: GoalSummary[]
): Map<string, GoalshqHealth> {
    return new Map(goalSummaries.map((g) => [g.uid, g.execution_health]));
}

export interface GoalInfo {
    title: string;
    status: string;
    health: GoalshqHealth;
}

/**
 * uid -> {title, status, health}, for tasks linked directly to a Goal with no
 * project (`task.goal_uid`) — the rollup engine's "direct bucket" case, which
 * bypasses the Strategy tier entirely. A task's *project* usually embeds its
 * own Goal object (title/status included), so this fuller lookup is only
 * needed when there's no project to read that from.
 */
export function buildGoalInfoMap(
    goalSummaries: GoalSummary[]
): Map<string, GoalInfo> {
    return new Map(
        goalSummaries.map((g) => [
            g.uid,
            { title: g.title, status: g.status, health: g.execution_health },
        ])
    );
}

export interface StrategyAttribution {
    uid: string;
    name: string;
    health: GoalshqHealth;
}

/**
 * project id -> the Strategy actually driving that project, for Strategy-level
 * (not just Goal-level) attribution in the Today worksheet. A project linked
 * to more than one strategy (real, since Strategy<->Project is many-to-many —
 * see docs/goalshq/adr/0002-first-class-integration.md) picks the riskiest one
 * to surface, since that's the one worth a user's attention.
 */
export function buildProjectStrategyMap(
    goalSummaries: GoalSummary[],
    projects: Project[]
): Map<number, StrategyAttribution> {
    const projectIdByUid = new Map(
        projects
            .filter((p) => p.uid && p.id != null)
            .map((p) => [p.uid as string, p.id as number])
    );

    const map = new Map<number, StrategyAttribution>();
    goalSummaries.forEach((goal) => {
        goal.strategies.forEach((strat) => {
            strat.project_uids.forEach((uid) => {
                const projectId = projectIdByUid.get(uid);
                if (projectId == null) return;
                const existing = map.get(projectId);
                if (
                    !existing ||
                    HEALTH_RISK_RANK[strat.summary.health] <
                        HEALTH_RISK_RANK[existing.health]
                ) {
                    map.set(projectId, {
                        uid: strat.uid,
                        name: strat.name,
                        health: strat.summary.health,
                    });
                }
            });
        });
    });
    return map;
}

interface AreaStats {
    name: string;
    color: string;
    total: number;
    share: number;
}

const FALLBACK_COLOR = '#6b7280';

function getPriorityScore(priority: Task['priority']): number {
    if (priority === 'high' || priority === 2) return 100;
    if (priority === 'medium' || priority === 1) return 60;
    if (priority === 'low' || priority === 0) return 30;
    return 0;
}

function isPendingStatus(status: Task['status']): boolean {
    return (
        status === 'not_started' ||
        status === 'waiting' ||
        status === (0 as any) ||
        status === (1 as any)
    );
}

function isActiveProject(project: Project): boolean {
    return project.status !== 'done' && project.status !== 'cancelled';
}

function isSomedayTask(task: Task): boolean {
    return (task.tags ?? []).some(
        (tag) => tag.name?.toLowerCase() === 'someday'
    );
}

export function computeAreaStats(projects: Project[]): AreaStats[] {
    const map = new Map<string, { color: string; total: number }>();

    projects.forEach((p) => {
        const areaObj = (p as any).Area ?? p.area;
        const name = areaObj?.name ?? 'No Area';
        const color: string = areaObj?.color ?? FALLBACK_COLOR;
        const total = p.task_status?.total ?? 0;
        const existing = map.get(name);
        if (existing) {
            existing.total += total;
        } else {
            map.set(name, { color, total });
        }
    });

    const totalAll = Array.from(map.values()).reduce((s, a) => s + a.total, 0);

    return Array.from(map.entries()).map(([name, data]) => ({
        name,
        color: data.color,
        total: data.total,
        share: totalAll > 0 ? (data.total / totalAll) * 100 : 0,
    }));
}

const DUE_DATE_HORIZON_DAYS = 3;

function isEligibleForSuggestion(task: Task): boolean {
    const now = Date.now();

    if (task.defer_until) {
        const deferUntil = new Date(task.defer_until).getTime();
        if (!Number.isNaN(deferUntil) && deferUntil > now) return false;
    }

    if (task.due_date) {
        const due = new Date(task.due_date).getTime();
        if (
            !Number.isNaN(due) &&
            due > now + DUE_DATE_HORIZON_DAYS * 86_400_000
        )
            return false;
    }

    return true;
}

// Build one-per-project candidate pool: one next action per active project + all orphan tasks.
// Uses the task's own embedded Project.status (from getTaskIncludeConfigLight) so we don't
// depend on ID-matching against localProjects, which can silently fail.
export function buildCandidatePool(tasks: Task[], projects: Project[]): Task[] {
    const pendingTasks = tasks.filter(
        (t) =>
            isPendingStatus(t.status) &&
            !isSomedayTask(t) &&
            isEligibleForSuggestion(t)
    );

    // Group pending tasks by project_id, reading status from the embedded Project object
    const byProject = new Map<
        number,
        { tasks: Task[]; projectStatus: string | undefined }
    >();
    const orphans: Task[] = [];

    pendingTasks.forEach((task) => {
        const projectId = task.project_id ?? (task.Project as any)?.id ?? null;
        if (projectId) {
            const existing = byProject.get(projectId);
            if (existing) {
                existing.tasks.push(task);
            } else {
                const projectStatus =
                    (task.Project as any)?.status ??
                    projects.find((p) => p.id === projectId)?.status;
                byProject.set(projectId, {
                    tasks: [task],
                    projectStatus,
                });
            }
        } else {
            orphans.push(task);
        }
    });

    const candidates: Task[] = [];

    // One next action per active project
    byProject.forEach(({ tasks: projTasks, projectStatus }) => {
        if (!isActiveProject({ status: projectStatus } as Project)) return;

        const sorted = [...projTasks].sort((a, b) => {
            const pa = getPriorityScore(a.priority);
            const pb = getPriorityScore(b.priority);
            if (pb !== pa) return pb - pa;
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateA - dateB;
        });
        candidates.push(sorted[0]);
    });

    candidates.push(...orphans);
    return candidates;
}

export function scoreCandidate(
    task: Task,
    projects: Project[],
    areaStats: AreaStats[],
    opts: SuggestionOpts = {},
    goalHealthByUid: Map<string, GoalshqHealth> = new Map(),
    strategyByProjectId: Map<number, StrategyAttribution> = new Map(),
    goalInfoByUid: Map<string, GoalInfo> = new Map()
): SuggestionMeta {
    const project = projects.find((p) => p.id === task.project_id);
    const areaObj = project ? ((project as any).Area ?? project.area) : null;
    const areaName: string = areaObj?.name ?? 'No Area';
    const areaColor: string = areaObj?.color ?? FALLBACK_COLOR;
    const areaStat = areaStats.find((a) => a.name === areaName);

    let score = getPriorityScore(task.priority);
    let reason: SuggestionReason = 'next_step';

    // Orphan boost: tasks without a project get a slight nudge
    if (!task.project_id) {
        score += 5;
    }

    // Due today / overdue nudge (highest priority nudge)
    const today = new Date().toISOString().split('T')[0];
    if (task.due_date) {
        const dueStr = task.due_date.split('T')[0];
        if (dueStr <= today) {
            score += 15;
            reason = 'due';
        }
    }

    // Strategy nudge: prefer attributing to the Strategy actually driving this
    // project (the more specific "engine") over its parent Goal. Only projects
    // with no strategy link (a "direct" goal project) fall back to goal-level
    // attribution below. A strategy GoalsHQ has flagged at_risk/off_track gets
    // a stronger nudge, same as the goal-level case.
    const strategyAttribution = task.project_id
        ? strategyByProjectId.get(task.project_id)
        : undefined;
    if (reason === 'next_step' && strategyAttribution) {
        if (AT_RISK_HEALTH.includes(strategyAttribution.health)) {
            score += 20;
            reason = 'strategy_at_risk';
        } else {
            score += 12;
            reason = 'strategy';
        }
    }

    // Goal nudge: task belongs to a project serving an active goal, with no
    // strategy tier of its own (a "direct" project). A goal that GoalsHQ has
    // flagged at_risk/off_track gets a stronger nudge — this is what surfaces
    // "advances an at-risk goal" in the Today worksheet (Phase C) rather than
    // just "advances an active goal".
    if (reason === 'next_step') {
        const goalObj = project
            ? ((project as any).Goal ?? (project as any).goal)
            : null;
        if (goalObj && goalObj.status === 'active') {
            const health = goalObj.uid
                ? goalHealthByUid.get(goalObj.uid)
                : undefined;
            if (health && AT_RISK_HEALTH.includes(health)) {
                score += 20;
                reason = 'goal_at_risk';
            } else {
                score += 12;
                reason = 'goal';
            }
        }
    }

    // Goal nudge, no-project variant: a task can be linked straight to a Goal
    // with no Project at all (`task.goal_uid`) — the rollup engine's "direct
    // bucket". No project means no Strategy link is even possible, so this
    // only ever attributes at the Goal level, same slack as the project case.
    const taskGoalUid = (task as any).goal_uid as string | null | undefined;
    if (reason === 'next_step' && !project && taskGoalUid) {
        const info = goalInfoByUid.get(taskGoalUid);
        if (info && info.status === 'active') {
            if (AT_RISK_HEALTH.includes(info.health)) {
                score += 20;
                reason = 'goal_at_risk';
            } else {
                score += 12;
                reason = 'goal';
            }
        }
    }

    // Context filter nudge
    if (opts.contextFilter && reason === 'next_step') {
        const hasContextTag = (task.tags ?? []).some(
            (tag) =>
                tag.name?.toLowerCase() === opts.contextFilter?.toLowerCase()
        );
        if (hasContextTag) {
            score += 10;
            reason = 'fits_now';
        }
    }

    // Stalled project nudge
    if (project?.is_stalled && reason === 'next_step') {
        score += 8;
        reason = 'revive';
    }

    // Balance mode nudge (opt-in only)
    if (opts.balanceMode && areaStat && reason === 'next_step') {
        const numAreas = areaStats.filter((a) => a.total > 0).length;
        const equalShare = numAreas > 0 ? 100 / numAreas : 100;
        if (areaStat.share < equalShare * 0.6) {
            score += 30;
            reason = 'area_balance';
        } else if (areaStat.share < equalShare * 0.85) {
            score += 15;
            reason = 'area_balance';
        }
    }

    // High priority chip (no score change - score already captured in priority_score)
    if (
        reason === 'next_step' &&
        (task.priority === 'high' || task.priority === 2)
    ) {
        reason = 'high';
    }

    // Aging review chip - only for orphan tasks (no project), informational only, no score change.
    // Project next-actions keep 'next_step' regardless of age: an old project task is a real
    // next action, not a deletion candidate.
    const refDate = task.updated_at ?? task.created_at;
    let agingDays = 0;
    if (refDate) {
        agingDays = Math.round(
            (Date.now() - new Date(refDate).getTime()) / 86_400_000
        );
    }
    if (
        reason === 'next_step' &&
        agingDays >= 60 &&
        !task.project_id &&
        !hasPriority(task)
    ) {
        reason = 'aging_review';
    }

    // Build chip label and color
    const projectName = project?.name ?? '';

    let reasonLabel: string;
    let reasonColor: string;

    switch (reason) {
        case 'due': {
            const isOverdue = task.due_date
                ? task.due_date.split('T')[0] < today
                : false;
            reasonLabel = isOverdue
                ? 'This task is overdue'
                : 'This task is due today';
            reasonColor = isOverdue ? '#f97316' : '#ef4444';
            break;
        }
        case 'goal': {
            const goalObj = project
                ? ((project as any).Goal ?? (project as any).goal)
                : null;
            const goalTitle =
                goalObj?.title ??
                (taskGoalUid
                    ? goalInfoByUid.get(taskGoalUid)?.title
                    : undefined);
            reasonLabel = goalTitle
                ? `Advances: ${goalTitle}`
                : 'Advances an active goal';
            reasonColor = areaColor;
            break;
        }
        case 'goal_at_risk': {
            const goalObj = project
                ? ((project as any).Goal ?? (project as any).goal)
                : null;
            const goalTitle =
                goalObj?.title ??
                (taskGoalUid
                    ? goalInfoByUid.get(taskGoalUid)?.title
                    : undefined);
            reasonLabel = goalTitle
                ? `Advances an at-risk goal: ${goalTitle}`
                : 'Advances an at-risk goal';
            reasonColor = '#f59e0b';
            break;
        }
        case 'strategy': {
            reasonLabel = strategyAttribution
                ? `Advances: ${strategyAttribution.name}`
                : 'Advances an active strategy';
            reasonColor = areaColor;
            break;
        }
        case 'strategy_at_risk': {
            reasonLabel = strategyAttribution
                ? `Advances an at-risk strategy: ${strategyAttribution.name}`
                : 'Advances an at-risk strategy';
            reasonColor = '#f59e0b';
            break;
        }
        case 'fits_now':
            reasonLabel = 'Matches your current context';
            reasonColor = areaColor;
            break;
        case 'revive':
            reasonLabel = projectName
                ? `Completing this moves ${projectName} forward`
                : 'Completing this revives stalled work';
            reasonColor = FALLBACK_COLOR;
            break;
        case 'high':
            reasonLabel = 'High priority - worth tackling now';
            reasonColor = '#ef4444';
            break;
        case 'aging_review':
            reasonLabel = `Hasn't been touched in ${agingDays} days - still relevant?`;
            reasonColor = FALLBACK_COLOR;
            break;
        case 'area_balance':
            reasonLabel = `Helps balance your ${areaName} area`;
            reasonColor = areaStat?.color ?? FALLBACK_COLOR;
            break;
        case 'next_step':
        default:
            reasonLabel = projectName
                ? `The next open step in ${projectName}`
                : 'A good action to tackle next';
            reasonColor = areaColor;
            reason = 'next_step';
            break;
    }

    return { score, reason, reasonLabel, reasonColor };
}

function hasPriority(task: Task): boolean {
    const p = task.priority;
    return (
        p === 'high' ||
        p === 2 ||
        p === 'medium' ||
        p === 1 ||
        p === 'low' ||
        p === 0
    );
}

// Returns 0=high, 1=medium, 2=low, 3=none — used as the primary sort key.
function priorityTier(task: Task): number {
    const p = task.priority;
    if (p === 'high' || p === 2) return 0;
    if (p === 'medium' || p === 1) return 1;
    if (p === 'low' || p === 0) return 2;
    return 3;
}

export function scoreAndSortSuggestedTasks(
    tasks: Task[],
    projects: Project[],
    opts: SuggestionOpts = {},
    goalHealthByUid: Map<string, GoalshqHealth> = new Map(),
    strategyByProjectId: Map<number, StrategyAttribution> = new Map(),
    goalInfoByUid: Map<string, GoalInfo> = new Map()
): Array<Task & { _suggestionMeta: SuggestionMeta }> {
    const areaStats = computeAreaStats(projects);
    const candidates = buildCandidatePool(tasks, projects);

    const scored = candidates.map((task) => ({
        ...task,
        _suggestionMeta: scoreCandidate(
            task,
            projects,
            areaStats,
            opts,
            goalHealthByUid,
            strategyByProjectId,
            goalInfoByUid
        ),
    }));

    scored.sort((a, b) => b._suggestionMeta.score - a._suggestionMeta.score);

    // Safety net: enforce max 1 task per project after scoring
    const seenProjects = new Set<number>();
    const deduped = scored.filter((task) => {
        if (task.project_id == null) return true;
        if (seenProjects.has(task.project_id)) return false;
        seenProjects.add(task.project_id);
        return true;
    });

    // Stale tasks are informational nudges — cap at 1 and push to the end.
    const nonStale = deduped.filter(
        (t) => t._suggestionMeta.reason !== 'aging_review'
    );
    const stale = deduped.filter(
        (t) => t._suggestionMeta.reason === 'aging_review'
    );

    // Final ordering by composite bucket key: (priorityTier * 2) + isOrphan
    // Bucket 0: project + high    Bucket 1: orphan + high
    // Bucket 2: project + medium  Bucket 3: orphan + medium
    // Bucket 4: project + low     Bucket 5: orphan + low
    // Bucket 6: project + none    Bucket 7: orphan + none
    nonStale.sort((a, b) => {
        const aBucket = priorityTier(a) * 2 + (a.project_id != null ? 0 : 1);
        const bBucket = priorityTier(b) * 2 + (b.project_id != null ? 0 : 1);
        if (aBucket !== bBucket) return aBucket - bBucket;
        return b._suggestionMeta.score - a._suggestionMeta.score;
    });

    return [...nonStale, ...stale.slice(0, 1)];
}
