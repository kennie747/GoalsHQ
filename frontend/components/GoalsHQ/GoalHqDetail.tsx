import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { GoalDetail, GoalProgressMode } from '../../entities/GoalsHq';
import {
    fetchGoalshqGoal,
    updateGoalSettings,
    createStrategy,
} from '../../utils/goalsHqService';
import { uidFromSlug, strategyHqPath } from './core/tududiApi';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    ImportanceStars,
    TrendSparkline,
} from './components/ui';
import MetricsPanels from './components/MetricsPanels';

const GOAL_MODES: GoalProgressMode[] = [
    'rollup_strategies',
    'rollup_projects',
    'rollup_tasks',
    'metric',
    'milestones',
    'manual',
];

const GoalHqDetail: React.FC = () => {
    const { t } = useTranslation();
    const { uidSlug } = useParams<{ uidSlug: string }>();
    const uid = uidFromSlug(uidSlug);

    const [goal, setGoal] = useState<GoalDetail | null>(null);
    const [error, setError] = useState(false);
    const [newStrategy, setNewStrategy] = useState('');

    const load = useCallback(async () => {
        try {
            setGoal(await fetchGoalshqGoal(uid));
        } catch {
            setError(true);
        }
    }, [uid]);

    useEffect(() => {
        load();
    }, [load]);

    if (error) {
        return (
            <div className="p-6 text-red-600 dark:text-red-400">
                {t('goalshq.loadError', 'Could not load this goal.')}
            </div>
        );
    }
    if (!goal) {
        return (
            <div className="p-6 text-gray-500 dark:text-gray-400">
                {t('common.loading', 'Loading...')}
            </div>
        );
    }

    const setMode = async (mode: GoalProgressMode) => {
        await updateGoalSettings(uid, { progress_mode: mode });
        load();
    };
    const setImportance = async (v: number) => {
        await updateGoalSettings(uid, { importance: v });
        load();
    };
    const addStrategy = async () => {
        if (!newStrategy.trim()) return;
        await createStrategy(uid, { name: newStrategy.trim() });
        setNewStrategy('');
        load();
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-6">
            <Link
                to="/goalshq"
                className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
                <ArrowLeftIcon className="h-4 w-4" />
                {t('goalshq.title', 'GoalsHQ')}
            </Link>

            <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                        {goal.title}
                    </h1>
                    {goal.why && (
                        <p className="mt-1 italic text-gray-500 dark:text-gray-400">
                            {goal.why}
                        </p>
                    )}
                </div>
                <HealthChip health={goal.health} />
            </div>

            <div className="mb-6 flex items-center gap-3">
                <ProgressBar
                    percent={goal.percent}
                    health={goal.health}
                    className="max-w-xs"
                />
                <PercentLabel percent={goal.percent} />
                <TrendSparkline points={goal.trend} />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <label className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">
                        {t('goalshq.progressMode', 'Progress from')}
                    </span>
                    <select
                        value={goal.settings.progress_mode}
                        onChange={(e) =>
                            setMode(e.target.value as GoalProgressMode)
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {GOAL_MODES.map((m) => (
                            <option key={m} value={m}>
                                {t(`goalshq.mode.${m}`, m)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">
                        {t('goalshq.importance', 'Importance')}
                    </span>
                    <ImportanceStars
                        value={goal.settings.importance}
                        onChange={setImportance}
                    />
                </label>
            </div>

            {/* Strategies */}
            <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.strategies', 'Strategies')}
                </h2>
                <div className="space-y-2">
                    {goal.strategies.map((s) => (
                        <Link
                            key={s.uid}
                            to={strategyHqPath(s.uid, s.name)}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:shadow-sm dark:border-gray-700"
                        >
                            <span className="flex-1 font-medium text-gray-800 dark:text-gray-100">
                                {s.name}
                            </span>
                            <span className="text-xs text-gray-400">
                                {s.kind}
                            </span>
                            <ImportanceStars value={s.importance} />
                            <ProgressBar
                                percent={s.percent}
                                health={s.health}
                                className="w-24"
                            />
                            <PercentLabel percent={s.percent} />
                            <HealthChip health={s.health} />
                        </Link>
                    ))}
                    {goal.strategies.length === 0 && (
                        <p className="text-sm text-gray-400">
                            {t(
                                'goalshq.noStrategies',
                                'No strategies yet — add the engine(s) that will move this goal.'
                            )}
                        </p>
                    )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                    <input
                        value={newStrategy}
                        onChange={(e) => setNewStrategy(e.target.value)}
                        placeholder={t(
                            'goalshq.newStrategy',
                            'New strategy name'
                        )}
                        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <button
                        onClick={addStrategy}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                    >
                        {t('common.add', 'Add')}
                    </button>
                </div>
            </section>

            {/* Direct projects */}
            {goal.direct_projects.length > 0 && (
                <section className="mb-8">
                    <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                        {t('goalshq.directProjects', 'Direct projects')}
                    </h2>
                    <ul className="space-y-1 text-sm">
                        {goal.direct_projects.map((p) => (
                            <li
                                key={p.uid}
                                className="flex items-center gap-3 rounded border border-gray-200 p-2 dark:border-gray-700"
                            >
                                <span className="flex-1 text-gray-800 dark:text-gray-100">
                                    {p.name}
                                </span>
                                <ProgressBar
                                    percent={p.percent}
                                    className="w-24"
                                />
                                <PercentLabel percent={p.percent} />
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Goal-level metrics */}
            <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.goalMetrics', 'Goal metrics')}
                </h2>
                <MetricsPanels
                    parentType="goal"
                    parentUid={uid}
                    keyResults={goal.key_results}
                    milestones={goal.milestones}
                    onChange={load}
                />
            </section>
        </div>
    );
};

export default GoalHqDetail;
