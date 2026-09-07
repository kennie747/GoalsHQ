import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    FlagIcon,
    ChevronRightIcon,
    PencilSquareIcon,
    TrashIcon,
    MapPinIcon,
    FolderIcon,
    CheckCircleIcon,
    RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import { useStore } from '../../store/useStore';
import { GoalSummary } from '../../entities/Goal';
import { GoalStrategySummary } from '../../entities/Strategy';
import {
    createGoalUrl,
    createStrategyUrl,
    createProjectUrl,
} from '../../utils/slugUtils';
import {
    updateStrategy,
    deleteStrategy,
    createStrategy,
} from '../../utils/goalsHqService';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
    ImportanceStars,
} from '../Shared/ProgressIndicators';
import Tooltip from '../Shared/Tooltip';
import ConfirmDialog from '../Shared/ConfirmDialog';
import { useToast } from '../Shared/ToastContext';

const isInactive = (s: GoalStrategySummary) =>
    s.status !== 'active' || s.kind === 'experiment';

const StrategyLink: React.FC<{ className?: string; children: React.ReactNode; to: string }> =
    ({ to, className, children }) => (
        <Link
            to={to}
            className={`text-gray-800 hover:text-blue-500 hover:underline dark:text-gray-100 dark:hover:text-blue-400 ${
                className || ''
            }`}
        >
            {children}
        </Link>
    );

/** One strategy row inside an expanded goal card — name link, health/progress, and
 * hover-revealed rename/delete, plus the projects it's linked to underneath. */
const StrategyRow: React.FC<{
    strategy: GoalStrategySummary;
    onRenamed: (uid: string, name: string) => void;
    onDeleted: (uid: string) => void;
}> = ({ strategy, onRenamed, onDeleted }) => {
    const { t } = useTranslation();
    const { showSuccessToast, showErrorToast } = useToast();
    const [isEditing, setIsEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState(strategy.name);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [busy, setBusy] = useState(false);

    const beginEdit = () => {
        setNameDraft(strategy.name);
        setIsEditing(true);
    };

    const saveRename = async () => {
        const trimmed = nameDraft.trim();
        if (!trimmed || trimmed === strategy.name) {
            setIsEditing(false);
            return;
        }
        setBusy(true);
        try {
            await updateStrategy(strategy.uid, { name: trimmed });
            onRenamed(strategy.uid, trimmed);
            setIsEditing(false);
        } catch {
            showErrorToast(
                t('goalshq.renameStrategyError', 'Could not rename strategy.')
            );
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        setBusy(true);
        try {
            await deleteStrategy(strategy.uid);
            onDeleted(strategy.uid);
            showSuccessToast(
                t('goalshq.strategyDeleted', 'Strategy deleted.')
            );
        } catch {
            showErrorToast(
                t('goalshq.deleteStrategyError', 'Could not delete strategy.')
            );
        } finally {
            setBusy(false);
            setIsConfirmingDelete(false);
        }
    };

    return (
        <div className="group rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isEditing ? (
                        <input
                            autoFocus
                            value={nameDraft}
                            disabled={busy}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveRename();
                                if (e.key === 'Escape') setIsEditing(false);
                            }}
                            onBlur={saveRename}
                            className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-2 py-0.5 text-sm font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                        />
                    ) : (
                        <StrategyLink
                            to={createStrategyUrl(strategy)}
                            className="truncate font-medium"
                        >
                            {strategy.name}
                        </StrategyLink>
                    )}
                    {strategy.kind === 'experiment' && (
                        <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            {t('goalshq.experiment', 'experiment')}
                        </span>
                    )}
                    {strategy.status !== 'active' && (
                        <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            {t(
                                `goalshq.strategyStatus.${strategy.status}`,
                                strategy.status
                            )}
                        </span>
                    )}
                </div>
                <ProgressBar
                    percent={strategy.percent}
                    health={strategy.health}
                    className="w-20 flex-shrink-0"
                />
                <PercentLabel percent={strategy.percent} />
                <HealthChip health={strategy.health} />
                <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                        type="button"
                        onClick={beginEdit}
                        aria-label={t('common.edit', 'Edit')}
                        title={t('common.edit', 'Edit')}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                        <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsConfirmingDelete(true)}
                        aria-label={t('common.delete', 'Delete')}
                        title={t('common.delete', 'Delete')}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
                    >
                        <TrashIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div className="mt-1.5 pl-0.5 text-xs text-gray-500 dark:text-gray-400">
                {strategy.projects.length === 0 ? (
                    <span className="italic text-gray-400 dark:text-gray-500">
                        {t('goalshq.noProjectsLinkedShort', 'No projects linked')}
                    </span>
                ) : (
                    strategy.projects.map((p, i) => (
                        <React.Fragment key={p.uid}>
                            {i > 0 && <span className="mx-1">·</span>}
                            <StrategyLink to={createProjectUrl(p)}>
                                {p.name}
                            </StrategyLink>
                        </React.Fragment>
                    ))
                )}
            </div>

            {isConfirmingDelete && (
                <ConfirmDialog
                    title={t('goalshq.deleteStrategyTitle', 'Delete Strategy')}
                    message={t(
                        'goalshq.deleteStrategyMessage',
                        `Are you sure you want to delete "${strategy.name}"? This can't be undone.`,
                        { name: strategy.name }
                    )}
                    onConfirm={confirmDelete}
                    onCancel={() => setIsConfirmingDelete(false)}
                />
            )}
        </div>
    );
};

/** A goal's card on the Strategy overview — expands in place to show its
 * strategies (and their linked projects) instead of only ever linking away
 * to the Goal page. */
const GoalStrategyCard: React.FC<{ goal: GoalSummary }> = ({ goal }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const [showInactive, setShowInactive] = useState(false);
    const [strategies, setStrategies] = useState<GoalStrategySummary[]>(
        goal.strategies
    );

    useEffect(() => {
        setStrategies(goal.strategies);
    }, [goal.strategies]);

    if (strategies.length === 0) return null;

    const visible = strategies.filter((s) => !isInactive(s));
    const inactive = strategies.filter(isInactive);

    const handleRenamed = (uid: string, name: string) => {
        setStrategies((prev) =>
            prev.map((s) => (s.uid === uid ? { ...s, name } : s))
        );
    };
    const handleDeleted = (uid: string) => {
        setStrategies((prev) => prev.filter((s) => s.uid !== uid));
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <FlagIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <Tooltip
                        content={t(
                            'goalshq.goalLinkTooltip',
                            'Moving to the Goals section'
                        )}
                        position="top"
                    >
                        <Link
                            to={createGoalUrl({
                                uid: goal.uid,
                                title: goal.title,
                            })}
                            className="truncate font-medium text-gray-900 hover:text-blue-500 hover:underline dark:text-white dark:hover:text-blue-400"
                        >
                            {goal.title}
                        </Link>
                    </Tooltip>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                    <HealthChip health={goal.health} />
                    <button
                        type="button"
                        onClick={() => setIsExpanded((v) => !v)}
                        aria-expanded={isExpanded}
                        aria-label={t('goalshq.toggleStrategies', 'Toggle strategies')}
                        className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
                    >
                        <ChevronRightIcon
                            className="h-3.5 w-3.5 transition-transform duration-150"
                            style={{
                                transform: isExpanded
                                    ? 'rotate(90deg)'
                                    : 'none',
                            }}
                        />
                    </button>
                </div>
            </div>

            <div className="mb-2 flex items-center gap-2">
                <ProgressBar percent={goal.percent} health={goal.health} />
                <PercentLabel percent={goal.percent} />
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                    {strategies.length} {t('goalshq.strategies', 'Strategies')}
                </span>
                {goal.settings && (
                    <ImportanceStars value={goal.settings.importance} />
                )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {goal.area && (
                    <span className="inline-flex items-center gap-1">
                        <MapPinIcon className="h-3.5 w-3.5 text-gray-400" />
                        {goal.area.name}
                    </span>
                )}
                <span className="inline-flex items-center gap-1">
                    <FolderIcon className="h-3.5 w-3.5 text-gray-400" />
                    {t('goalshq.projectsCount', '{{count}} projects', {
                        count: goal.projects_count,
                    })}
                </span>
                <span className="inline-flex items-center gap-1">
                    <CheckCircleIcon className="h-3.5 w-3.5 text-gray-400" />
                    {t('goalshq.tasksCount', '{{count}} tasks', {
                        count: goal.tasks_count,
                    })}
                </span>
            </div>

            {goal.target_date && (
                <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {t('goalshq.targetDate', 'Target')}: {goal.target_date}
                </div>
            )}

            {isExpanded && (
                <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                    <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {t('goalshq.strategiesForGoal', 'Strategies for {{goal}}', {
                            goal: goal.title,
                        })}
                    </div>
                    <div className="space-y-2">
                        {visible.map((s) => (
                            <StrategyRow
                                key={s.uid}
                                strategy={s}
                                onRenamed={handleRenamed}
                                onDeleted={handleDeleted}
                            />
                        ))}
                        {inactive.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowInactive((v) => !v)
                                    }
                                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    {showInactive
                                        ? t(
                                              'goalshq.hideInactiveStrategies',
                                              'Hide paused/experimental strategies'
                                          )
                                        : t(
                                              'goalshq.showInactiveStrategies',
                                              'Show {{count}} paused/experimental strategies',
                                              { count: inactive.length }
                                          )}
                                </button>
                                {showInactive &&
                                    inactive.map((s) => (
                                        <StrategyRow
                                            key={s.uid}
                                            strategy={s}
                                            onRenamed={handleRenamed}
                                            onDeleted={handleDeleted}
                                        />
                                    ))}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/** Shown when no goal has any strategy yet — a goal picker + name field to
 * create the first one, instead of leaving the page's whole point empty. */
const NoStrategiesEmptyState: React.FC<{ goals: GoalSummary[] }> = ({
    goals,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { showErrorToast } = useToast();
    const [goalUid, setGoalUid] = useState(goals[0]?.uid || '');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (!goalUid || !name.trim()) return;
        setBusy(true);
        try {
            const created = await createStrategy(goalUid, {
                name: name.trim(),
            });
            navigate(createStrategyUrl(created));
        } catch {
            showErrorToast(
                t('goalshq.createStrategyError', 'Could not create strategy.')
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-800">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500">
                <RocketLaunchIcon className="h-5 w-5" />
            </div>
            <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
                {t('goalshq.noStrategiesAnywhereTitle', 'No strategies yet')}
            </h2>
            <p className="mx-auto mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
                {t(
                    'goalshq.noStrategiesAnywhereBody',
                    "Strategies break a goal down into the paths you'll actually pursue to reach it. Pick a goal below and give its first strategy a name."
                )}
            </p>

            {goals.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t(
                        'goalshq.newStrategyNoGoals',
                        'Create a goal first — a strategy always belongs to one.'
                    )}{' '}
                    <Link
                        to="/goal/new"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                        {t('goals.newGoal', 'New Goal')}
                    </Link>
                </p>
            ) : (
                <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-2">
                    <select
                        value={goalUid}
                        onChange={(e) => setGoalUid(e.target.value)}
                        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {goals.map((g) => (
                            <option key={g.uid} value={g.uid}>
                                {g.title}
                            </option>
                        ))}
                    </select>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submit()}
                        placeholder={t(
                            'goalshq.strategyNamePlaceholder',
                            'Strategy name'
                        )}
                        className="flex-[2] rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <button
                        type="button"
                        disabled={busy || !goalUid || !name.trim()}
                        onClick={submit}
                        className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('goalshq.createStrategyCta', 'Create Strategy')}
                    </button>
                </div>
            )}
        </div>
    );
};

/** Goals sorted by strategy health/risk — the GoalsHQ overview. */
const StrategyOverview: React.FC = () => {
    const { t } = useTranslation();
    const { goalSummaries, isLoading, isError, hasLoaded, loadGoalSummaries } =
        useStore((state) => state.strategiesStore);

    useEffect(() => {
        loadGoalSummaries();
    }, [loadGoalSummaries]);

    const atRisk = goalSummaries.filter(
        (g) => g.health === 'off_track' || g.health === 'at_risk'
    );
    const goalsWithStrategies = goalSummaries.filter(
        (g) => g.strategies.length > 0
    );

    return (
        <div className="mx-auto max-w-5xl px-4 py-6">
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {t('goalshq.title', 'Strategy')}
                </h1>
                <button
                    onClick={() => loadGoalSummaries(true)}
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

            {hasLoaded && goalsWithStrategies.length === 0 ? (
                <NoStrategiesEmptyState goals={goalSummaries} />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {goalsWithStrategies.map((goal) => (
                        <GoalStrategyCard key={goal.uid} goal={goal} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default StrategyOverview;
