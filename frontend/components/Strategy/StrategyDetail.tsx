import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeftIcon,
    PencilSquareIcon,
    TrashIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { Strategy } from '../../entities/Strategy';
import {
    fetchStrategy,
    setStrategyProjects,
    deleteStrategy,
} from '../../utils/goalsHqService';
import DeleteConfirmDialog from '../Shared/DeleteConfirmDialog';
import { useToast } from '../Shared/ToastContext';
import {
    extractUidFromSlug,
    createProjectUrl,
    createGoalUrl,
} from '../../utils/slugUtils';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    TrendSparkline,
} from '../Shared/ProgressIndicators';
import MetricsPanels from './MetricsPanels';
import StrategyModal from './StrategyModal';
import RecordsPanel from './RecordsPanel';
import ReportTab from './ReportTab';

const statusPillCls: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    paused: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    achieved:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    dropped: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

const StrategyDetail: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { uidSlug } = useParams<{ uidSlug: string }>();
    const isNew = uidSlug === 'new';
    const uid = extractUidFromSlug(uidSlug || '');

    const { showSuccessToast, showErrorToast } = useToast();
    const [strategy, setStrategy] = useState<Strategy | null>(null);
    const [error, setError] = useState(false);
    const [editing, setEditing] = useState(isNew);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [tab, setTab] = useState<'overview' | 'records' | 'report'>(
        'overview'
    );

    const load = useCallback(async () => {
        if (isNew) return;
        try {
            setStrategy(await fetchStrategy(uid));
        } catch {
            setError(true);
        }
    }, [uid, isNew]);

    useEffect(() => {
        load();
    }, [load]);

    if (isNew) {
        return (
            <StrategyModal
                isOpen
                onClose={() => navigate('/strategy')}
                onSaved={(s) =>
                    navigate(`/strategy/${s.uid}`, { replace: true })
                }
            />
        );
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

    const counts = strategy.project_counts;
    const countsLabel = counts
        ? [
              `${counts.total} ${t('goalshq.projectsWord', 'projects')}`,
              counts.in_progress
                  ? `${counts.in_progress} ${t('goalshq.inProgress', 'in progress')}`
                  : null,
              counts.done ? `${counts.done} ${t('common.done', 'done')}` : null,
          ]
              .filter(Boolean)
              .join(' · ')
        : '';

    const unlink = async (projectUid: string) => {
        const next = strategy.projects
            .map((p) => p.uid)
            .filter((u) => u !== projectUid);
        setStrategy(await setStrategyProjects(strategy.uid, next));
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

            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {strategy.color && (
                            <span
                                className="h-3 w-3 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: strategy.color }}
                            />
                        )}
                        <h1 className="truncate text-2xl font-semibold text-gray-900 dark:text-white">
                            {strategy.name}
                        </h1>
                        <span
                            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs ${
                                statusPillCls[strategy.status] ||
                                statusPillCls.paused
                            }`}
                        >
                            {t(
                                `goalshq.strategyStatus.${strategy.status}`,
                                strategy.status
                            )}
                        </span>
                    </div>
                    {strategy.description && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {strategy.description}
                        </p>
                    )}
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {t('goalshq.parentGoal', 'Goal')}:{' '}
                        {strategy.goal ? (
                            <Link
                                to={createGoalUrl({
                                    uid: strategy.goal.uid,
                                    title: strategy.goal.title,
                                })}
                                className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                                {strategy.goal.title}
                            </Link>
                        ) : (
                            <span className="italic">
                                {t('goalshq.noGoal', 'No goal')}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                        <PencilSquareIcon className="h-4 w-4" />
                        {t('common.edit', 'Edit')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirmingDelete(true)}
                        aria-label={t('common.delete', 'Delete')}
                        title={t('common.delete', 'Delete')}
                        className="inline-flex items-center rounded-md border border-red-300 p-2 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                        <TrashIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {confirmingDelete && (
                <DeleteConfirmDialog
                    itemLabel={strategy.name}
                    extra={t(
                        'goalshq.deleteStrategyExtra',
                        'Its Key Results and Milestones are deleted too; linked projects are kept.'
                    )}
                    onCancel={() => setConfirmingDelete(false)}
                    onConfirm={async () => {
                        try {
                            await deleteStrategy(strategy.uid);
                            showSuccessToast(
                                t(
                                    'goalshq.strategyDeleted',
                                    'Strategy deleted'
                                )
                            );
                            navigate('/strategy');
                        } catch (e) {
                            showErrorToast((e as Error).message);
                            setConfirmingDelete(false);
                        }
                    }}
                />
            )}

            {/* Tabs */}
            <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
                {(['overview', 'records', 'report'] as const).map((x) => (
                    <button
                        key={x}
                        onClick={() => setTab(x)}
                        className={`border-b-2 px-3 py-2 text-sm ${
                            tab === x
                                ? 'border-blue-500 font-semibold text-gray-900 dark:text-white'
                                : 'border-transparent text-gray-500'
                        }`}
                    >
                        {t(`goalshq.tab_${x}`, x)}
                    </button>
                ))}
            </div>

            {tab === 'records' && (
                <RecordsPanel
                    parentType="strategy"
                    parentUid={uid}
                    keyResults={strategy.key_results || []}
                />
            )}
            {tab === 'report' && (
                <ReportTab parentType="strategy" parentUid={uid} />
            )}
            {tab === 'overview' && (
                <>
                    {/* Grouping summary */}
                    <div className="mb-6 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                {t(
                                    'goalshq.groupingSummary',
                                    'Grouping summary'
                                )}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                {t(
                                    'goalshq.avgOfNProjects',
                                    'avg of {{count}} projects',
                                    {
                                        count: counts?.total ?? 0,
                                    }
                                )}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <ProgressBar
                                percent={strategy.summary.percent}
                                health={strategy.summary.health}
                                className="max-w-xs"
                            />
                            <PercentLabel percent={strategy.summary.percent} />
                            <HealthChip health={strategy.summary.health} />
                            <TrendSparkline points={strategy.trend || []} />
                        </div>
                    </div>

                    {/* Roster */}
                    <section className="mb-8">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                {t('goalshq.linkedProjects', 'Projects')}
                            </h2>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {countsLabel}
                            </span>
                        </div>
                        <ul className="space-y-1 text-sm">
                            {strategy.projects.map((p) => (
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
                                    <span className="hidden text-xs text-gray-400 sm:inline">
                                        {p.status}
                                    </span>
                                    <button
                                        aria-label={t(
                                            'goalshq.unlink',
                                            'Unlink'
                                        )}
                                        onClick={() => unlink(p.uid)}
                                        className="text-gray-400 hover:text-red-500"
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                            {strategy.projects.length === 0 && (
                                <li className="text-xs text-gray-400">
                                    {t(
                                        'goalshq.noLinkedProjects',
                                        'No projects yet — add some from Edit.'
                                    )}
                                </li>
                            )}
                        </ul>
                    </section>

                    {/* Optional KRs / milestones (context only) */}
                    <section>
                        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-white">
                            {t(
                                'goalshq.strategyMetrics',
                                'Key Results & Milestones'
                            )}
                        </h2>
                        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                            {t(
                                'goalshq.strategyMetricsHint',
                                'For context — these are not rolled into the goal.'
                            )}
                        </p>
                        <MetricsPanels
                            parentType="strategy"
                            parentUid={uid}
                            keyResults={strategy.key_results || []}
                            milestones={strategy.milestones || []}
                            readOnly={!strategy.metrics_editable}
                            propagateTargets={(strategy.projects || []).map(
                                (p) => ({
                                    parent_type: 'project' as const,
                                    parent_uid: p.uid,
                                    label: `${p.name} (project)`,
                                })
                            )}
                            onChange={load}
                        />
                    </section>
                </>
            )}

            {editing && (
                <StrategyModal
                    isOpen
                    strategy={strategy}
                    onClose={() => setEditing(false)}
                    onSaved={(s) => setStrategy(s)}
                    onDeleted={() => navigate('/strategy')}
                />
            )}
        </div>
    );
};

export default StrategyDetail;
