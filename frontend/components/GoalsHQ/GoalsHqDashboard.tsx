import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FlagIcon } from '@heroicons/react/24/outline';
import { useGoalsHqStore } from '../../store/useGoalsHqStore';
import { goalHqPath } from './core/tududiApi';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    ImportanceStars,
} from './components/ui';

const GoalsHqDashboard: React.FC = () => {
    const { t } = useTranslation();
    const { goals, isLoading, isError, hasLoaded, loadGoals } =
        useGoalsHqStore();

    useEffect(() => {
        loadGoals();
    }, [loadGoals]);

    const atRisk = goals.filter(
        (g) => g.health === 'off_track' || g.health === 'at_risk'
    );

    return (
        <div className="mx-auto max-w-5xl px-4 py-6">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.title', 'GoalsHQ')}
                </h1>
                <button
                    onClick={() => loadGoals(true)}
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                    {t('common.refresh', 'Refresh')}
                </button>
            </div>

            {isError && (
                <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                    {t('goalshq.loadError', 'Could not load GoalsHQ data.')}
                </div>
            )}

            {atRisk.length > 0 && (
                <div className="mb-6 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500 dark:bg-amber-950/30 dark:text-amber-200">
                    {t('goalshq.atRiskCallout', {
                        defaultValue:
                            '{{count}} goal(s) are behind schedule and need attention.',
                        count: atRisk.length,
                    })}
                </div>
            )}

            {isLoading && !hasLoaded && (
                <div className="text-gray-500 dark:text-gray-400">
                    {t('common.loading', 'Loading...')}
                </div>
            )}

            {hasLoaded && goals.length === 0 && (
                <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    {t(
                        'goalshq.empty',
                        'No goals yet. Create a goal in tududi, then add strategies and metrics here.'
                    )}
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {goals.map((goal) => (
                    <Link
                        key={goal.uid}
                        to={goalHqPath(goal.uid, goal.title)}
                        className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                    >
                        <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <FlagIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                                <span className="font-medium text-gray-900 dark:text-white">
                                    {goal.title}
                                </span>
                            </div>
                            <HealthChip health={goal.health} />
                        </div>

                        <div className="mb-2 flex items-center gap-2">
                            <ProgressBar
                                percent={goal.percent}
                                health={goal.health}
                            />
                            <PercentLabel percent={goal.percent} />
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>
                                {goal.strategies.length}{' '}
                                {t('goalshq.strategies', 'strategies')}
                            </span>
                            {goal.settings && (
                                <ImportanceStars
                                    value={goal.settings.importance}
                                />
                            )}
                        </div>

                        {goal.target_date && (
                            <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                                {t('goalshq.targetDate', 'Target')}:{' '}
                                {goal.target_date}
                            </div>
                        )}
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default GoalsHqDashboard;
