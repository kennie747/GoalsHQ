import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useStore } from '../../store/useStore';
import { Strategy } from '../../entities/Strategy';
import { GoalSummary } from '../../entities/Goal';
import { createGoalUrl, createStrategyUrl } from '../../utils/slugUtils';
import { fetchStrategies } from '../../utils/goalsHqService';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
} from '../Shared/ProgressIndicators';
import StrategyModal from './StrategyModal';

const StrategyRow: React.FC<{ strategy: Strategy }> = ({ strategy }) => {
    const { t } = useTranslation();
    const counts = strategy.project_counts;
    return (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            {strategy.color && (
                <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: strategy.color }}
                />
            )}
            <Link
                to={createStrategyUrl(strategy)}
                className="min-w-0 flex-1 truncate font-medium text-gray-800 hover:text-blue-500 hover:underline dark:text-gray-100 dark:hover:text-blue-400"
            >
                {strategy.name}
            </Link>
            {strategy.status !== 'active' && (
                <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {t(
                        `goalshq.strategyStatus.${strategy.status}`,
                        strategy.status
                    )}
                </span>
            )}
            <ProgressBar
                percent={strategy.summary.percent}
                health={strategy.summary.health}
                className="w-20 flex-shrink-0"
            />
            <PercentLabel percent={strategy.summary.percent} />
            <HealthChip health={strategy.summary.health} />
            <span className="hidden flex-shrink-0 text-xs text-gray-400 sm:inline">
                {t('goalshq.projectsCount', '{{count}} projects', {
                    count: counts?.total ?? 0,
                })}
            </span>
        </div>
    );
};

const StrategyOverview: React.FC = () => {
    const { t } = useTranslation();
    const { goalSummaries, loadGoalSummaries } = useStore(
        (state) => state.strategiesStore
    );
    const [strategies, setStrategies] = useState<Strategy[] | null>(null);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        try {
            setStrategies(await fetchStrategies());
        } catch {
            setStrategies([]);
        }
    }, []);

    useEffect(() => {
        loadGoalSummaries();
        load();
    }, [loadGoalSummaries, load]);

    const byGoal = new Map<string, Strategy[]>();
    const unassigned: Strategy[] = [];
    for (const s of strategies || []) {
        if (s.goal) {
            const list = byGoal.get(s.goal.uid) || [];
            list.push(s);
            byGoal.set(s.goal.uid, list);
        } else {
            unassigned.push(s);
        }
    }

    const goalsWithStrategies: GoalSummary[] = goalSummaries.filter((g) =>
        byGoal.has(g.uid)
    );

    return (
        <div className="mx-auto max-w-5xl px-4 py-6">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.title', 'Strategy')}
                </h1>
                <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                    <PlusIcon className="h-4 w-4" />
                    {t('goalshq.newStrategy', 'New strategy')}
                </button>
            </div>

            {strategies === null ? (
                <p className="text-gray-500 dark:text-gray-400">
                    {t('common.loading', 'Loading...')}
                </p>
            ) : (strategies || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    {t(
                        'goalshq.noStrategiesAnywhereBody',
                        'Strategies group the projects that belong together — "Real Estate", "Systems Security". Create your first one.'
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {goalsWithStrategies.map((goal) => (
                        <div
                            key={goal.uid}
                            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                        >
                            <div className="mb-2 flex items-center gap-3">
                                <Link
                                    to={createGoalUrl({
                                        uid: goal.uid,
                                        title: goal.title,
                                    })}
                                    className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-blue-500 hover:underline dark:text-white dark:hover:text-blue-400"
                                >
                                    {goal.title}
                                </Link>
                                <ProgressBar
                                    percent={goal.execution_percent}
                                    className="w-24"
                                />
                                <PercentLabel
                                    percent={goal.execution_percent}
                                />
                                <HealthChip health={goal.execution_health} />
                            </div>
                            <div className="space-y-2">
                                {(byGoal.get(goal.uid) || []).map((s) => (
                                    <StrategyRow key={s.uid} strategy={s} />
                                ))}
                            </div>
                        </div>
                    ))}

                    {unassigned.length > 0 && (
                        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                                {t(
                                    'goalshq.unassignedStrategies',
                                    'Unassigned strategies'
                                )}
                            </div>
                            <div className="space-y-2">
                                {unassigned.map((s) => (
                                    <StrategyRow key={s.uid} strategy={s} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {creating && (
                <StrategyModal
                    isOpen
                    onClose={() => setCreating(false)}
                    onSaved={() => {
                        load();
                        loadGoalSummaries(true);
                    }}
                />
            )}
        </div>
    );
};

export default StrategyOverview;
