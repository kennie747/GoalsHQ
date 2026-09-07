import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Strategy, StrategyProgressMode } from '../../entities/Strategy';
import { GoalSummary } from '../../entities/Goal';
import {
    fetchStrategy,
    updateStrategy,
    linkProject,
    unlinkProject,
    createStrategy,
    fetchGoalshqGoals,
} from '../../utils/goalsHqService';
import { fetchProjects } from '../../utils/projectsService';
import {
    extractUidFromSlug,
    createProjectUrl,
    createStrategyUrl,
} from '../../utils/slugUtils';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    ImportanceStars,
    TrendSparkline,
} from '../Shared/ProgressIndicators';
import MetricsPanels from './MetricsPanels';

const MODES: StrategyProgressMode[] = [
    'rollup_projects',
    'rollup_tasks',
    'metric',
    'milestones',
    'manual',
];

interface PickableProject {
    uid: string;
    name: string;
}

const NewStrategyForm: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [goals, setGoals] = useState<GoalSummary[] | null>(null);
    const [goalUid, setGoalUid] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    useEffect(() => {
        fetchGoalshqGoals()
            .then((g) => {
                setGoals(g);
                if (g.length > 0) setGoalUid(g[0].uid);
            })
            .catch(() => setGoals([]));
    }, []);

    const submit = async () => {
        if (!goalUid || !name.trim()) return;
        setBusy(true);
        setFormError(null);
        try {
            const created = await createStrategy(goalUid, {
                name: name.trim(),
            });
            navigate(createStrategyUrl(created));
        } catch {
            setFormError(
                t('goalshq.createStrategyError', 'Could not create strategy.')
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto max-w-4xl px-4 py-6">
            <Link
                to="/strategy"
                className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
                <ArrowLeftIcon className="h-4 w-4" />
                {t('goalshq.title', 'Strategy')}
            </Link>
            <h1 className="mb-6 text-2xl font-semibold text-gray-900 dark:text-white">
                {t('goalshq.newStrategyTitle', 'New Strategy')}
            </h1>

            {goals === null ? (
                <p className="text-gray-500 dark:text-gray-400">
                    {t('common.loading', 'Loading...')}
                </p>
            ) : goals.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">
                    {t(
                        'goalshq.newStrategyNoGoals',
                        'Create a goal first — a strategy always belongs to one.'
                    )}
                </p>
            ) : (
                <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <label className="block">
                        <span className="mb-1 block text-sm text-gray-500 dark:text-gray-400">
                            {t('goalshq.parentGoal', 'Goal')}
                        </span>
                        <select
                            value={goalUid}
                            onChange={(e) => setGoalUid(e.target.value)}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        >
                            {goals.map((g) => (
                                <option key={g.uid} value={g.uid}>
                                    {g.title}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm text-gray-500 dark:text-gray-400">
                            {t('goalshq.newStrategy', 'New strategy name')}
                        </span>
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && submit()}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        />
                    </label>
                    {formError && (
                        <p className="text-sm text-red-600 dark:text-red-400">
                            {formError}
                        </p>
                    )}
                    <button
                        disabled={busy || !goalUid || !name.trim()}
                        onClick={submit}
                        className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.create', 'Create')}
                    </button>
                </div>
            )}
        </div>
    );
};

const StrategyDetail: React.FC = () => {
    const { t } = useTranslation();
    const { uidSlug } = useParams<{ uidSlug: string }>();
    const isNew = uidSlug === 'new';
    const uid = extractUidFromSlug(uidSlug || '');

    const [strategy, setStrategy] = useState<Strategy | null>(null);
    const [error, setError] = useState(false);
    const [allProjects, setAllProjects] = useState<PickableProject[]>([]);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [linking, setLinking] = useState(false);

    const load = useCallback(async () => {
        if (isNew) return;
        try {
            setStrategy(await fetchStrategy(uid));
        } catch {
            setError(true);
        }
    }, [uid, isNew]);

    useEffect(() => {
        if (isNew) return;
        load();
        fetchProjects('all', '')
            .then((projects) =>
                setAllProjects(
                    (projects || [])
                        .filter((p) => p && p.uid)
                        .map((p) => ({ uid: p.uid as string, name: p.name }))
                )
            )
            .catch(() => undefined);
    }, [load, isNew]);

    if (isNew) {
        return <NewStrategyForm />;
    }

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
                to="/strategy"
                className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
                <ArrowLeftIcon className="h-4 w-4" />
                {t('goalshq.title', 'Strategy')}
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
                            patch({
                                status: e.target
                                    .value as Strategy['status'],
                            })
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
                            <Link
                                to={createProjectUrl({
                                    uid: p.uid,
                                    name: p.name,
                                })}
                                className="flex-1 truncate text-gray-800 hover:text-blue-500 hover:underline dark:text-gray-100 dark:hover:text-blue-400"
                            >
                                {p.name}
                            </Link>
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
                {available.length > 0 && (
                    <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
                        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                            {t(
                                'goalshq.pickProjectsHint',
                                'Select one or more projects to link — a project can belong to several strategies at once.'
                            )}
                        </p>
                        <ul className="mb-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                            {available.map((p) => (
                                <li key={p.uid}>
                                    <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                                        <input
                                            type="checkbox"
                                            checked={picked.has(p.uid)}
                                            onChange={(e) => {
                                                const next = new Set(picked);
                                                if (e.target.checked)
                                                    next.add(p.uid);
                                                else next.delete(p.uid);
                                                setPicked(next);
                                            }}
                                        />
                                        <span className="text-gray-800 dark:text-gray-100">
                                            {p.name}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <button
                            disabled={picked.size === 0 || linking}
                            onClick={async () => {
                                setLinking(true);
                                try {
                                    await Promise.all(
                                        [...picked].map((projectUid) =>
                                            linkProject(uid, projectUid)
                                        )
                                    );
                                    setPicked(new Set());
                                    load();
                                } finally {
                                    setLinking(false);
                                }
                            }}
                            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {picked.size > 1
                                ? t('goalshq.linkSelected', 'Link {{count}} projects', {
                                      count: picked.size,
                                  })
                                : t('goalshq.link', 'Link')}
                        </button>
                    </div>
                )}
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
