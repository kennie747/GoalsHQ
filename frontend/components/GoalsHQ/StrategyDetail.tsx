import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Strategy, StrategyProgressMode } from '../../entities/GoalsHq';
import {
    fetchStrategy,
    updateStrategy,
    linkProject,
    unlinkProject,
} from '../../utils/goalsHqService';
import {
    fetchActiveProjects,
    PickableProject,
    uidFromSlug,
} from './core/tududiApi';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    ImportanceStars,
    TrendSparkline,
} from './components/ui';
import MetricsPanels from './components/MetricsPanels';

const MODES: StrategyProgressMode[] = [
    'rollup_projects',
    'rollup_tasks',
    'metric',
    'milestones',
    'manual',
];

const StrategyDetail: React.FC = () => {
    const { t } = useTranslation();
    const { uidSlug } = useParams<{ uidSlug: string }>();
    const uid = uidFromSlug(uidSlug);

    const [strategy, setStrategy] = useState<Strategy | null>(null);
    const [error, setError] = useState(false);
    const [allProjects, setAllProjects] = useState<PickableProject[]>([]);
    const [pick, setPick] = useState('');

    const load = useCallback(async () => {
        try {
            setStrategy(await fetchStrategy(uid));
        } catch {
            setError(true);
        }
    }, [uid]);

    useEffect(() => {
        load();
        fetchActiveProjects()
            .then(setAllProjects)
            .catch(() => undefined);
    }, [load]);

    if (error) {
        return (
            <div className="p-6 text-red-600 dark:text-red-400">
                {t('goalshq.loadError', 'Could not load this strategy.')}
            </div>
        );
    }
    if (!strategy) {
        return (
            <div className="p-6 text-gray-500 dark:text-gray-400">
                {t('common.loading', 'Loading...')}
            </div>
        );
    }

    const linkedUids = new Set((strategy.projects || []).map((p) => p.uid));
    const available = allProjects.filter((p) => !linkedUids.has(p.uid));

    const patch = async (data: Partial<Strategy>) => {
        await updateStrategy(uid, data);
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
                <input
                    defaultValue={strategy.name}
                    onBlur={(e) =>
                        e.target.value.trim() &&
                        e.target.value !== strategy.name &&
                        patch({ name: e.target.value.trim() })
                    }
                    className="w-full rounded border border-transparent bg-transparent text-2xl font-semibold text-gray-900 focus:border-gray-300 dark:text-white dark:focus:border-gray-600"
                />
                <HealthChip health={strategy.health} />
            </div>

            <div className="mb-6 flex items-center gap-3">
                <ProgressBar
                    percent={strategy.percent}
                    health={strategy.health}
                    className="max-w-xs"
                />
                <PercentLabel percent={strategy.percent} />
                <TrendSparkline points={strategy.trend || []} />
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <label className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">
                        {t('goalshq.progressMode', 'Progress from')}
                    </span>
                    <select
                        value={strategy.progress_mode}
                        onChange={(e) =>
                            patch({
                                progress_mode: e.target
                                    .value as StrategyProgressMode,
                            })
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {MODES.map((m) => (
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
                        value={strategy.importance}
                        onChange={(v) => patch({ importance: v })}
                    />
                </label>
                <label className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">
                        {t('goalshq.status', 'Status')}
                    </span>
                    <select
                        value={strategy.status}
                        onChange={(e) =>
                            patch({ status: e.target.value as any })
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {['active', 'paused', 'achieved', 'dropped'].map(
                            (v) => (
                                <option key={v} value={v}>
                                    {t(`goalshq.strategyStatus.${v}`, v)}
                                </option>
                            )
                        )}
                    </select>
                </label>
            </div>

            {/* Linked projects */}
            <section className="mb-8">
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.linkedProjects', 'Linked projects')}
                </h2>
                <ul className="mb-3 space-y-1 text-sm">
                    {(strategy.projects || []).map((p) => (
                        <li
                            key={p.uid}
                            className="flex items-center gap-3 rounded border border-gray-200 p-2 dark:border-gray-700"
                        >
                            <span className="flex-1 text-gray-800 dark:text-gray-100">
                                {p.name}
                            </span>
                            <ProgressBar percent={p.percent} className="w-24" />
                            <PercentLabel percent={p.percent} />
                            <button
                                aria-label={t('goalshq.unlink', 'Unlink')}
                                onClick={async () => {
                                    await unlinkProject(uid, p.uid);
                                    load();
                                }}
                                className="text-gray-400 hover:text-red-500"
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {(strategy.projects || []).length === 0 && (
                        <li className="text-xs text-gray-400">
                            {t(
                                'goalshq.noLinkedProjects',
                                'No projects linked yet.'
                            )}
                        </li>
                    )}
                </ul>
                <div className="flex items-center gap-2">
                    <select
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        <option value="">
                            {t('goalshq.pickProject', 'Choose a project…')}
                        </option>
                        {available.map((p) => (
                            <option key={p.uid} value={p.uid}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                    <button
                        disabled={!pick}
                        onClick={async () => {
                            await linkProject(uid, pick);
                            setPick('');
                            load();
                        }}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('goalshq.link', 'Link')}
                    </button>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.strategyMetrics', 'Strategy metrics')}
                </h2>
                <MetricsPanels
                    parentType="strategy"
                    parentUid={uid}
                    keyResults={strategy.key_results || []}
                    milestones={strategy.milestones || []}
                    onChange={load}
                />
            </section>
        </div>
    );
};

export default StrategyDetail;
