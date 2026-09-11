import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Task } from '../../entities/Task';
import { Project } from '../../entities/Project';
import { GoalSummary } from '../../entities/Goal';
import { GoalshqHealth } from '../../entities/GoalSettings';
import { HealthChip } from '../Shared/ProgressIndicators';
import { createGoalUrl, createStrategyUrl } from '../../utils/slugUtils';
import { buildProjectStrategyMap } from '../../utils/suggestionScoringUtils';

interface Props {
    tasks: Task[];
    projects: Project[];
    goalSummaries: GoalSummary[];
    enabled: boolean;
}

interface DrivingItem {
    key: string;
    label: string;
    health: GoalshqHealth;
    to: string;
}

const HEALTH_RANK: Record<string, number> = {
    off_track: 0,
    at_risk: 1,
    on_track: 2,
    no_data: 3,
};

const AT_RISK: GoalshqHealth[] = ['at_risk', 'off_track'];

/**
 * "Today's priorities are driven by" strip — surfaces which at-risk/off-track
 * Strategies (or, for a project with no strategy of its own, Goals) are
 * actually represented among today's tasks, so a busy task list still carries
 * the strategic "why" (Phase C — see
 * docs/goalshq/adr/0002-first-class-integration.md).
 *
 * Attribution prefers the Strategy actually driving a project — the more
 * specific "engine" — and only falls back to the Goal for direct projects
 * with no strategy of their own, mirroring suggestionScoringUtils.ts's own
 * preference order.
 */
const TodayStrategyBanner: React.FC<Props> = ({
    tasks,
    projects,
    goalSummaries,
    enabled,
}) => {
    const { t } = useTranslation();

    const drivingItems = useMemo(() => {
        if (!enabled || goalSummaries.length === 0) return [];

        const strategyByProjectId = buildProjectStrategyMap(
            goalSummaries,
            projects
        );
        const goalSummaryByUid = new Map(goalSummaries.map((g) => [g.uid, g]));
        const projectById = new Map(projects.map((p) => [p.id, p]));
        const seen = new Map<string, DrivingItem>();

        tasks.forEach((task) => {
            if (task.project_id == null) {
                // No project at all — a task can still be linked straight to
                // a Goal (task.goal_uid, the rollup engine's "direct bucket").
                // No project means no Strategy link is even possible.
                const goalUid = (task as any).goal_uid as
                    | string
                    | null
                    | undefined;
                if (!goalUid) return;
                const summary = goalSummaryByUid.get(goalUid);
                if (!summary) return;
                seen.set(`goal:${summary.uid}`, {
                    key: `goal:${summary.uid}`,
                    label: summary.title,
                    health: summary.execution_health,
                    to: createGoalUrl({
                        uid: summary.uid,
                        title: summary.title,
                    }),
                });
                return;
            }

            const strategy = strategyByProjectId.get(task.project_id);
            if (strategy) {
                seen.set(`strategy:${strategy.uid}`, {
                    key: `strategy:${strategy.uid}`,
                    label: strategy.name,
                    health: strategy.health,
                    to: createStrategyUrl({
                        uid: strategy.uid,
                        name: strategy.name,
                    }),
                });
                return;
            }

            const project = projectById.get(task.project_id);
            const goalObj: any = project
                ? ((project as any).Goal ?? (project as any).goal)
                : null;
            if (!goalObj?.uid) return;
            const summary = goalSummaryByUid.get(goalObj.uid);
            if (!summary) return;
            seen.set(`goal:${summary.uid}`, {
                key: `goal:${summary.uid}`,
                label: summary.title,
                health: summary.execution_health,
                to: createGoalUrl({ uid: summary.uid, title: summary.title }),
            });
        });

        return Array.from(seen.values())
            .filter((item) => AT_RISK.includes(item.health))
            .sort(
                (a, b) =>
                    (HEALTH_RANK[a.health] ?? 9) - (HEALTH_RANK[b.health] ?? 9)
            )
            .slice(0, 3);
    }, [tasks, projects, goalSummaries, enabled]);

    if (drivingItems.length === 0) return null;

    return (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="font-medium">
                {t('tasks.todayDrivenBy', "Today's priorities are driven by:")}
            </span>
            {drivingItems.map((item) => (
                <Link
                    key={item.key}
                    to={item.to}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-2 py-0.5 hover:bg-white dark:bg-black/20 dark:hover:bg-black/30"
                >
                    <span className="font-medium">{item.label}</span>
                    <HealthChip health={item.health} />
                </Link>
            ))}
        </div>
    );
};

export default TodayStrategyBanner;
