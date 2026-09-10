import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { fetchGoalshqGoal, updateGoalSettings } from '../../utils/goalsHqService';
import { GoalDetail } from '../../entities/Goal';
import { createProjectUrl, createStrategyUrl } from '../../utils/slugUtils';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    DualProgress,
} from '../Shared/ProgressIndicators';
import MetricsPanels from '../Strategy/MetricsPanels';
import RecordsPanel from '../Strategy/RecordsPanel';
import ReportTab from '../Strategy/ReportTab';
import StrategyModal from '../Strategy/StrategyModal';

interface Props {
    goalUid: string;
}

type Tab = 'progress' | 'records' | 'report';
type ProgressTab = 'execution' | 'strategies' | 'projects';

const TAB_LABELS: Record<Tab, string> = {
    progress: 'Progress',
    records: 'Records',
    report: 'Report',
};
const PROGRESS_TAB_LABELS: Record<ProgressTab, string> = {
    execution: 'Execution',
    strategies: 'Strategies',
    projects: 'Projects',
};

/**
 * GoalsHQ measurement surface for a single goal, mirrored on the "Metrics" tab
 * of the Goal detail page. Sub-tabs: Progress / Records / Report; Progress splits
 * into Execution / Strategies (projects grouped & collapsible by strategy) /
 * Projects. Self-fetching, like ProjectGoalsHqPanel.
 */
const GoalMetricsPanel: React.FC<Props> = ({ goalUid }) => {
    const { t } = useTranslation();
    const [hq, setHq] = useState<GoalDetail | null>(null);
    const [error, setError] = useState(false);
    const [tab, setTab] = useState<Tab>('progress');
    const [progressTab, setProgressTab] = useState<ProgressTab>('execution');
    const [strategyModalOpen, setStrategyModalOpen] = useState(false);
    const [collapsedStrategies, setCollapsedStrategies] = useState<Set<string>>(
        new Set()
    );

    const load = useCallback(async () => {
        try {
            setHq(await fetchGoalshqGoal(goalUid));
            setError(false);
        } catch {
            setError(true);
        }
    }, [goalUid]);

    useEffect(() => {
        load();
    }, [load]);

    const toggleOutcome = async (enabled: boolean) => {
        await updateGoalSettings(goalUid, { metrics_enabled: enabled });
        load();
    };

    const toggleStrategy = (uid: string) =>
        setCollapsedStrategies((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });

    if (error) {
        return (
            <p className="p-4 text-sm text-gray-400">
                {t('goalshq.metricsUnavailable', 'Metrics are unavailable.')}
            </p>
        );
    }
    if (!hq) {
        return (
            <p className="p-4 text-sm text-gray-400">
                {t('common.loading', 'Loading...')}
            </p>
        );
    }

    const metricsEnabled = hq.settings.metrics_enabled;
    const groupedProjectUids = new Set(
        hq.strategies.flatMap((s) => s.projects.map((p) => p.uid))
    );
    const ungrouped = hq.projects.filter(
        (p) => !groupedProjectUids.has(p.uid)
    );

    const projectRow = (p: {
        uid: string;
        name: string;
        status: string;
        execution_percent: number | null;
    }) => (
        <li key={p.uid} className="flex items-center gap-3 py-1 text-sm">
            <Link
                to={createProjectUrl({ uid: p.uid, name: p.name })}
                className="flex-1 truncate text-gray-700 hover:text-blue-500 dark:text-gray-200 dark:hover:text-blue-400"
            >
                {p.name}
            </Link>
            <span className="flex-shrink-0 text-xs text-gray-400">
                {p.status?.replace('_', ' ')}
            </span>
            <ProgressBar percent={p.execution_percent} className="w-24" />
            <PercentLabel percent={p.execution_percent} />
        </li>
    );

    return (
        <div>
            {/* Level 2 — underline tabs */}
            <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
                {(['progress', 'records', 'report'] as const).map((x) => (
                    <button
                        key={x}
                        onClick={() => setTab(x)}
                        className={`border-b-2 px-3 py-2 text-sm ${
                            tab === x
                                ? 'border-blue-500 font-semibold text-gray-900 dark:text-white'
                                : 'border-transparent text-gray-500'
                        }`}
                    >
                        {t(`goalshq.tab_${x}`, TAB_LABELS[x])}
                    </button>
                ))}
            </div>

            {tab === 'records' && (
                <RecordsPanel
                    parentType="goal"
                    parentUid={goalUid}
                    keyResults={hq.key_results}
                />
            )}
            {tab === 'report' && (
                <ReportTab parentType="goal" parentUid={goalUid} />
            )}

            {tab === 'progress' && (
                <>
                    {/* Level 3 — filled pills */}
                    <div className="mb-5 flex gap-2">
                        {(
                            ['execution', 'strategies', 'projects'] as const
                        ).map((x) => (
                            <button
                                key={x}
                                onClick={() => setProgressTab(x)}
                                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    progressTab === x
                                        ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                }`}
                            >
                                {t(
                                    `goalshq.progressTab_${x}`,
                                    PROGRESS_TAB_LABELS[x]
                                )}
                            </button>
                        ))}
                    </div>

                    {progressTab === 'execution' && (
                        <>
                            <DualProgress
                                executionPercent={hq.execution_percent}
                                executionHealth={hq.execution_health}
                                outcomePercent={hq.outcome_percent}
                                outcomeHealth={hq.outcome_health}
                                metricsEnabled={metricsEnabled}
                                executionNote={t(
                                    'goalshq.fromProjectsTasks',
                                    'from {{p}} projects + direct tasks',
                                    { p: hq.projects.length }
                                )}
                                outcomeNote={t(
                                    'goalshq.fromKrs',
                                    'from {{n}} key results',
                                    { n: hq.key_results.length }
                                )}
                                executionTrend={hq.trend.filter(
                                    (s) =>
                                        (s.kind ?? 'execution') === 'execution'
                                )}
                                outcomeTrend={hq.trend.filter(
                                    (s) => s.kind === 'outcome'
                                )}
                            />

                            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={metricsEnabled}
                                    onChange={(e) =>
                                        toggleOutcome(e.target.checked)
                                    }
                                />
                                {t(
                                    'goalshq.enableOutcomeMetrics',
                                    'Track outcome metrics (Key Results / Milestones)'
                                )}
                            </label>

                            {metricsEnabled && (
                                <section className="mt-6">
                                    <MetricsPanels
                                        parentType="goal"
                                        parentUid={goalUid}
                                        keyResults={hq.key_results}
                                        milestones={hq.milestones}
                                        propagateTargets={[
                                            ...hq.strategies.map((s) => ({
                                                parent_type: 'strategy' as const,
                                                parent_uid: s.uid,
                                                label: `${s.name} (strategy)`,
                                            })),
                                            ...hq.projects.map((p) => ({
                                                parent_type: 'project' as const,
                                                parent_uid: p.uid,
                                                label: `${p.name} (project)`,
                                            })),
                                        ]}
                                        onChange={load}
                                    />
                                </section>
                            )}
                        </>
                    )}

                    {progressTab === 'strategies' && (
                        <section>
                            <div className="mb-1 flex items-center justify-between">
                                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    {t('goalshq.strategies', 'Strategies')}
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setStrategyModalOpen(true)}
                                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                                >
                                    {t('goalshq.addStrategy', '+ New strategy')}
                                </button>
                            </div>
                            <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                                {t(
                                    'goalshq.strategiesGroupingHint',
                                    'Grouping only — not part of the numbers above.'
                                )}
                            </p>

                            <div className="space-y-2">
                                {hq.strategies.map((s) => {
                                    const open = !collapsedStrategies.has(
                                        s.uid
                                    );
                                    return (
                                        <div
                                            key={s.uid}
                                            className="rounded-lg border border-gray-200 dark:border-gray-700"
                                        >
                                            <div className="flex items-center gap-3 p-3">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        toggleStrategy(s.uid)
                                                    }
                                                    aria-label={t(
                                                        'common.toggle',
                                                        'Toggle'
                                                    )}
                                                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                                >
                                                    <ChevronRightIcon
                                                        className={`h-4 w-4 transition-transform ${
                                                            open
                                                                ? 'rotate-90'
                                                                : ''
                                                        }`}
                                                    />
                                                </button>
                                                {s.color && (
                                                    <span
                                                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                s.color,
                                                        }}
                                                    />
                                                )}
                                                <Link
                                                    to={createStrategyUrl({
                                                        uid: s.uid,
                                                        name: s.name,
                                                    })}
                                                    className="flex-1 truncate font-medium text-gray-800 hover:text-blue-500 dark:text-gray-100 dark:hover:text-blue-400"
                                                >
                                                    {s.name}
                                                </Link>
                                                {s.status !== 'active' && (
                                                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                        {t(
                                                            `goalshq.strategyStatus.${s.status}`,
                                                            s.status
                                                        )}
                                                    </span>
                                                )}
                                                <ProgressBar
                                                    percent={s.summary.percent}
                                                    health={s.summary.health}
                                                    className="w-20"
                                                />
                                                <PercentLabel
                                                    percent={s.summary.percent}
                                                />
                                                <HealthChip
                                                    health={s.summary.health}
                                                />
                                            </div>
                                            {open && (
                                                <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                                                    {s.projects.length === 0 ? (
                                                        <p className="py-1 text-xs text-gray-400">
                                                            {t(
                                                                'goalshq.noLinkedProjects',
                                                                'No projects linked yet.'
                                                            )}
                                                        </p>
                                                    ) : (
                                                        <ul className="space-y-1">
                                                            {s.projects.map(
                                                                (p) =>
                                                                    projectRow(
                                                                        p
                                                                    )
                                                            )}
                                                        </ul>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {ungrouped.length > 0 && (
                                    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-center gap-3 p-3">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    toggleStrategy('__ungrouped')
                                                }
                                                aria-label={t(
                                                    'common.toggle',
                                                    'Toggle'
                                                )}
                                                className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                            >
                                                <ChevronRightIcon
                                                    className={`h-4 w-4 transition-transform ${
                                                        collapsedStrategies.has(
                                                            '__ungrouped'
                                                        )
                                                            ? ''
                                                            : 'rotate-90'
                                                    }`}
                                                />
                                            </button>
                                            <span className="flex-1 font-medium text-gray-600 dark:text-gray-300">
                                                {t(
                                                    'goalshq.noStrategyGroup',
                                                    'Directly on the goal'
                                                )}
                                            </span>
                                            <span className="text-xs text-gray-400">
                                                {t(
                                                    'goalshq.projectsLinked',
                                                    '{{n}} project(s)',
                                                    { n: ungrouped.length }
                                                )}
                                            </span>
                                        </div>
                                        {!collapsedStrategies.has(
                                            '__ungrouped'
                                        ) && (
                                            <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                                                <ul className="space-y-1">
                                                    {ungrouped.map((p) =>
                                                        projectRow(p)
                                                    )}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {hq.strategies.length === 0 &&
                                    ungrouped.length === 0 && (
                                        <p className="text-sm text-gray-400">
                                            {t(
                                                'goalshq.noStrategies',
                                                'No strategies yet.'
                                            )}
                                        </p>
                                    )}
                            </div>
                        </section>
                    )}

                    {progressTab === 'projects' && (
                        <section>
                            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {t('goalshq.projects', 'Projects')}
                            </h3>
                            <ul className="space-y-1 text-sm">
                                {hq.projects.map((p) => (
                                    <li
                                        key={p.uid}
                                        className="flex items-center gap-3 rounded border border-gray-200 p-2 dark:border-gray-700"
                                    >
                                        <Link
                                            to={createProjectUrl({
                                                uid: p.uid,
                                                name: p.name,
                                            })}
                                            className="flex-1 truncate text-gray-800 hover:text-blue-500 hover:underline dark:text-gray-100 dark:hover:text-blue-400"
                                        >
                                            {p.name}
                                        </Link>
                                        <ProgressBar
                                            percent={p.execution_percent}
                                            className="w-24"
                                        />
                                        <PercentLabel
                                            percent={p.execution_percent}
                                        />
                                    </li>
                                ))}
                                {hq.projects.length === 0 && (
                                    <li className="text-xs text-gray-400">
                                        {t(
                                            'goalshq.noProjects',
                                            'No projects yet.'
                                        )}
                                    </li>
                                )}
                            </ul>
                        </section>
                    )}
                </>
            )}

            {strategyModalOpen && (
                <StrategyModal
                    isOpen
                    defaultGoalUid={goalUid}
                    onClose={() => setStrategyModalOpen(false)}
                    onSaved={load}
                />
            )}
        </div>
    );
};

export default GoalMetricsPanel;
