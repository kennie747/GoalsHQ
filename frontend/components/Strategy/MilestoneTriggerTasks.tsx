import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { Task } from '../../entities/Task';
import { fetchTasks } from '../../utils/tasksService';
import {
    getStatusButtonColorClasses,
    getStatusBorderColorClasses,
} from '../Task/statusStyles';

interface Props {
    linkedTaskUids: string[];
    linkedProjectUids: string[];
    onToggleTask: (taskUid: string) => void;
    onToggleProject: (projectUid: string) => void;
    readOnly?: boolean;
}

const NO_AREA = '__noarea__';
const NO_GOAL = '__nogoal__';
const NO_PROJECT = '__noproject__';
const CLOSED_PROJECT = new Set(['done', 'cancelled']);

// One shared pool for the whole session — toggling links never changes it.
let poolCache: { tasks: Task[]; at: number } | null = null;
const POOL_TTL = 60_000;
async function getTaskPool(): Promise<Task[]> {
    if (poolCache && Date.now() - poolCache.at < POOL_TTL) {
        return poolCache.tasks;
    }
    const res = await fetchTasks('?status=all');
    poolCache = { tasks: res.tasks || [], at: Date.now() };
    return poolCache.tasks;
}

/** Test-only: drop the shared task pool between cases. */
export const __clearTaskPoolCache = () => {
    poolCache = null;
};

const taskStatusKey = (s: Task['status']): string => {
    if (s === 'done' || s === 2) return 'done';
    if (s === 'in_progress' || s === 1) return 'in_progress';
    if (s === 'archived' || s === 3) return 'archived';
    if (s === 'waiting' || s === 4) return 'waiting';
    if (s === 'cancelled' || s === 5) return 'cancelled';
    if (s === 'planned' || s === 6) return 'planned';
    return 'not_started';
};

const projStatusChipCls = (status?: string): string =>
    `${getStatusBorderColorClasses(status as never)} ${getStatusButtonColorClasses(
        status as never
    )}`;

const goalStatusChip = (status?: string): string => {
    switch (status) {
        case 'achieved':
            return 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300';
        case 'paused':
            return 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300';
        case 'dropped':
            return 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300';
        default:
            return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300';
    }
};

interface Leaf {
    task: Task;
    linked: boolean;
    stale: boolean; // linked but its project is closed / it is done/cancelled
}
interface ProjectBucket {
    key: string;
    label: string;
    status?: string;
    leaves: Leaf[];
}
interface GoalBucket {
    key: string;
    label: string;
    status?: string;
    looseLeaves: Leaf[];
    projects: ProjectBucket[];
}
interface AreaBucket {
    key: string;
    label: string;
    goals: GoalBucket[];
}

const alpha = (a: string, b: string) => a.localeCompare(b);
const sortBuckets = <T extends { key: string; label: string }>(arr: T[]): T[] =>
    arr.sort((a, b) => {
        const an = a.key.startsWith('__');
        const bn = b.key.startsWith('__');
        if (an !== bn) return an ? 1 : -1;
        return alpha(a.label, b.label);
    });

function buildGroups(
    tasks: Task[],
    linkedSet: Set<string>,
    noAreaLabel: string,
    noGoalLabel: string,
    noProjectLabel: string
): AreaBucket[] {
    const areas = new Map<string, AreaBucket>();

    const leafOf = (task: Task): Leaf => {
        const closedProject =
            !!task.Project && CLOSED_PROJECT.has(task.Project.status || '');
        return {
            task,
            linked: linkedSet.has(task.uid || ''),
            stale:
                linkedSet.has(task.uid || '') &&
                (closedProject || taskStatusKey(task.status) === 'done'),
        };
    };

    for (const task of tasks) {
        const areaKey = task.Area?.uid ?? task.area_uid ?? NO_AREA;
        const areaLabel = task.Area?.name ?? noAreaLabel;
        const goalKey = task.Goal?.uid ?? task.goal_uid ?? NO_GOAL;
        const goalLabel = task.Goal?.title ?? noGoalLabel;
        const projKey = task.Project?.uid ?? task.project_uid ?? NO_PROJECT;
        const projLabel = task.Project?.name ?? noProjectLabel;

        let area = areas.get(areaKey);
        if (!area) {
            area = { key: areaKey, label: areaLabel, goals: [] };
            areas.set(areaKey, area);
        }
        let goal = area.goals.find((g) => g.key === goalKey);
        if (!goal) {
            goal = {
                key: goalKey,
                label: goalLabel,
                status: task.Goal?.status,
                looseLeaves: [],
                projects: [],
            };
            area.goals.push(goal);
        }
        const leaf = leafOf(task);
        if (projKey === NO_PROJECT) {
            goal.looseLeaves.push(leaf);
        } else {
            let proj = goal.projects.find((p) => p.key === projKey);
            if (!proj) {
                proj = {
                    key: projKey,
                    label: projLabel,
                    status: task.Project?.status,
                    leaves: [],
                };
                goal.projects.push(proj);
            }
            proj.leaves.push(leaf);
        }
    }

    const result = sortBuckets([...areas.values()]);
    for (const area of result) {
        sortBuckets(area.goals);
        for (const goal of area.goals) {
            sortBuckets(goal.projects);
            goal.looseLeaves.sort((a, b) => alpha(a.task.name, b.task.name));
            for (const proj of goal.projects) {
                proj.leaves.sort((a, b) => alpha(a.task.name, b.task.name));
            }
        }
    }
    return result;
}

const StatusChip: React.FC<{ label: string; cls: string }> = ({
    label,
    cls,
}) => (
    <span
        className={`ml-1 rounded px-1 py-px text-[10px] font-medium uppercase leading-none ${cls}`}
    >
        {label}
    </span>
);

const selectCls =
    'rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

const MilestoneTriggerTasks: React.FC<Props> = ({
    linkedTaskUids,
    linkedProjectUids,
    onToggleTask,
    onToggleProject,
    readOnly = false,
}) => {
    const { t } = useTranslation();
    // Resolved once — `t` identity is unstable under some i18n setups and these
    // feed a useMemo dep list.
    const labelsRef = React.useRef({
        noArea: t('goalshq.noArea', 'No area'),
        noGoal: t('goalshq.noGoal', 'No goal'),
        noProject: t('goalshq.noProject', 'Direct tasks'),
    });
    const [pool, setPool] = useState<Task[] | null>(null);
    const [fArea, setFArea] = useState('');
    const [fGoal, setFGoal] = useState('');
    const [fProject, setFProject] = useState('');
    const [fStatus, setFStatus] = useState('');
    const [search, setSearch] = useState('');
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

    useEffect(() => {
        let alive = true;
        getTaskPool()
            .then((tasks) => alive && setPool(tasks))
            .catch(() => alive && setPool([]));
        return () => {
            alive = false;
        };
    }, []);

    const linkedTaskSet = useMemo(
        () => new Set(linkedTaskUids),
        [linkedTaskUids]
    );
    const linkedProjectSet = useMemo(
        () => new Set(linkedProjectUids),
        [linkedProjectUids]
    );

    // Drop tasks in a done/cancelled project unless the task is already linked.
    const visiblePool = useMemo(() => {
        if (!pool) return [];
        return pool.filter((tk) => {
            if (linkedTaskSet.has(tk.uid || '')) return true;
            if (tk.Project && CLOSED_PROJECT.has(tk.Project.status || '')) {
                return false;
            }
            return true;
        });
    }, [pool, linkedTaskSet]);

    const facetOptions = useMemo(() => {
        const areas = new Map<string, string>();
        const goals = new Map<string, string>();
        const projects = new Map<string, string>();
        const statuses = new Set<string>();
        for (const tk of visiblePool) {
            areas.set(tk.Area?.uid ?? NO_AREA, tk.Area?.name ?? '');
            goals.set(tk.Goal?.uid ?? NO_GOAL, tk.Goal?.title ?? '');
            projects.set(tk.Project?.uid ?? NO_PROJECT, tk.Project?.name ?? '');
            statuses.add(taskStatusKey(tk.status));
        }
        const toList = (m: Map<string, string>) =>
            [...m.entries()]
                .map(([k, v]) => ({ key: k, label: v }))
                .sort((a, b) => {
                    const an = a.key.startsWith('__');
                    const bn = b.key.startsWith('__');
                    if (an !== bn) return an ? 1 : -1;
                    return alpha(a.label, b.label);
                });
        return {
            areas: toList(areas),
            goals: toList(goals),
            projects: toList(projects),
            statuses: [...statuses].sort(),
        };
    }, [visiblePool]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return visiblePool.filter((tk) => {
            if (fArea && (tk.Area?.uid ?? NO_AREA) !== fArea) return false;
            if (fGoal && (tk.Goal?.uid ?? NO_GOAL) !== fGoal) return false;
            if (fProject && (tk.Project?.uid ?? NO_PROJECT) !== fProject) {
                return false;
            }
            if (fStatus && taskStatusKey(tk.status) !== fStatus) return false;
            if (q && !tk.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [visiblePool, fArea, fGoal, fProject, fStatus, search]);

    const groups = useMemo(
        () =>
            buildGroups(
                filtered,
                linkedTaskSet,
                labelsRef.current.noArea,
                labelsRef.current.noGoal,
                labelsRef.current.noProject
            ),
        [filtered, linkedTaskSet]
    );

    const facetsActive =
        !!fArea || !!fGoal || !!fProject || !!fStatus || !!search.trim();

    // Default-open: chains with a linked task, or everything while filtering.
    const defaultOpen = useMemo(() => {
        const s = new Set<string>();
        for (const area of groups) {
            const areaK = `area:${area.key}`;
            for (const goal of area.goals) {
                const goalK = `${areaK}/goal:${goal.key}`;
                const anyLooseLinked = goal.looseLeaves.some((l) => l.linked);
                for (const proj of goal.projects) {
                    const projK = `${goalK}/proj:${proj.key}`;
                    if (
                        facetsActive ||
                        proj.leaves.some((l) => l.linked) ||
                        linkedProjectSet.has(proj.key)
                    ) {
                        s.add(areaK);
                        s.add(goalK);
                        s.add(projK);
                    }
                }
                if (facetsActive || anyLooseLinked) {
                    s.add(areaK);
                    s.add(goalK);
                }
            }
        }
        return s;
    }, [groups, facetsActive, linkedProjectSet]);

    useEffect(() => {
        setOpenGroups(defaultOpen);
    }, [defaultOpen]);

    const toggleGroup = (key: string) =>
        setOpenGroups((prev) => {
            const n = new Set(prev);
            if (n.has(key)) n.delete(key);
            else n.add(key);
            return n;
        });

    const total = filtered.length;
    const linkedInView = filtered.filter((tk) =>
        linkedTaskSet.has(tk.uid || '')
    ).length;

    if (pool === null) {
        return (
            <div className="mt-2 text-gray-400">
                {t('common.loading', 'Loading...')}
            </div>
        );
    }

    const renderLeaf = (leaf: Leaf, impliedByProject: boolean) => {
        const key = taskStatusKey(leaf.task.status);
        const checked =
            impliedByProject || linkedTaskSet.has(leaf.task.uid || '');
        return (
            <label
                key={leaf.task.uid}
                className={`flex items-center gap-2 py-px ${
                    leaf.stale ? 'italic opacity-60' : ''
                }`}
                title={
                    impliedByProject
                        ? t(
                              'goalshq.impliedByProject',
                              'Included via the whole-project trigger'
                          )
                        : leaf.stale
                          ? t(
                                'goalshq.linkedStale',
                                'Still linked; no longer in an open project'
                            )
                          : undefined
                }
            >
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly || impliedByProject}
                    onChange={() => onToggleTask(leaf.task.uid || '')}
                />
                <span
                    className={
                        key === 'done' ? 'text-gray-400 line-through' : ''
                    }
                >
                    {leaf.task.name}
                </span>
                <StatusChip
                    label={key.replace('_', ' ')}
                    cls={getStatusButtonColorClasses(leaf.task.status)}
                />
            </label>
        );
    };

    const header = (
        key: string,
        label: string,
        indent: string,
        extras?: React.ReactNode,
        counts?: { linked: number; total: number }
    ) => {
        const open = openGroups.has(key);
        return (
            <button
                type="button"
                onClick={() => toggleGroup(key)}
                className={`flex w-full items-center gap-1 py-0.5 text-left ${indent} text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white`}
            >
                {open ? (
                    <ChevronDownIcon className="h-3 w-3 flex-shrink-0" />
                ) : (
                    <ChevronRightIcon className="h-3 w-3 flex-shrink-0" />
                )}
                {extras}
                <span className="truncate font-medium">{label}</span>
                {counts && (
                    <span className="ml-1 text-[10px] text-gray-400">
                        ({counts.linked}/{counts.total})
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-600">
            <div className="mb-1 flex items-center justify-between">
                <span className="text-gray-500">
                    {t('goalshq.linkTasks', 'Link tasks & projects:')}
                </span>
                <button
                    type="button"
                    onClick={() =>
                        setOpenGroups((prev) =>
                            prev.size > 0 ? new Set() : defaultOpen
                        )
                    }
                    className="text-[10px] text-blue-500 hover:underline"
                >
                    {openGroups.size > 0
                        ? t('goalshq.groupCollapseAll', 'Collapse all')
                        : t('goalshq.groupExpandAll', 'Expand all')}
                </button>
            </div>

            <div className="mb-1 flex flex-wrap items-center gap-1">
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('goalshq.searchTasks', 'Search tasks…')}
                    className={`${selectCls} min-w-[110px] flex-1`}
                />
                <select
                    value={fArea}
                    onChange={(e) => setFArea(e.target.value)}
                    className={selectCls}
                >
                    <option value="">{t('goalshq.filterArea', 'Area')}</option>
                    {facetOptions.areas.map((o) => (
                        <option key={o.key} value={o.key}>
                            {o.label || t('goalshq.noArea', 'No area')}
                        </option>
                    ))}
                </select>
                <select
                    value={fGoal}
                    onChange={(e) => setFGoal(e.target.value)}
                    className={selectCls}
                >
                    <option value="">{t('goalshq.filterGoal', 'Goal')}</option>
                    {facetOptions.goals.map((o) => (
                        <option key={o.key} value={o.key}>
                            {o.label || t('goalshq.noGoal', 'No goal')}
                        </option>
                    ))}
                </select>
                <select
                    value={fProject}
                    onChange={(e) => setFProject(e.target.value)}
                    className={selectCls}
                >
                    <option value="">
                        {t('goalshq.filterProject', 'Project')}
                    </option>
                    {facetOptions.projects.map((o) => (
                        <option key={o.key} value={o.key}>
                            {o.label || t('goalshq.noProject', 'Direct tasks')}
                        </option>
                    ))}
                </select>
                <select
                    value={fStatus}
                    onChange={(e) => setFStatus(e.target.value)}
                    className={selectCls}
                >
                    <option value="">
                        {t('goalshq.filterStatus', 'Status')}
                    </option>
                    {facetOptions.statuses.map((s) => (
                        <option key={s} value={s}>
                            {s.replace('_', ' ')}
                        </option>
                    ))}
                </select>
            </div>

            <div className="text-[10px] text-gray-400">
                {t('goalshq.linkCounts', '{{linked}} of {{total}} linked', {
                    linked: linkedInView,
                    total,
                })}
            </div>

            <div className="mt-1 max-h-72 space-y-px overflow-y-auto text-xs">
                {total === 0 && (
                    <div className="text-gray-400">
                        {t('goalshq.noLinkableTasks', 'No tasks match.')}
                    </div>
                )}
                {groups.map((area) => {
                    const areaK = `area:${area.key}`;
                    return (
                        <div key={areaK}>
                            {header(areaK, area.label, 'pl-0')}
                            {openGroups.has(areaK) &&
                                area.goals.map((goal) => {
                                    const goalK = `${areaK}/goal:${goal.key}`;
                                    return (
                                        <div key={goalK}>
                                            {header(
                                                goalK,
                                                goal.label,
                                                'pl-3',
                                                goal.status && goal.key !== NO_GOAL ? (
                                                    <StatusChip
                                                        label={goal.status}
                                                        cls={goalStatusChip(
                                                            goal.status
                                                        )}
                                                    />
                                                ) : undefined
                                            )}
                                            {openGroups.has(goalK) && (
                                                <>
                                                    {goal.looseLeaves.length >
                                                        0 && (
                                                        <div className="pl-6">
                                                            <div className="py-px text-[10px] uppercase tracking-wide text-gray-400">
                                                                {t(
                                                                    'goalshq.noProject',
                                                                    'Direct tasks'
                                                                )}
                                                            </div>
                                                            {goal.looseLeaves.map(
                                                                (l) =>
                                                                    renderLeaf(
                                                                        l,
                                                                        false
                                                                    )
                                                            )}
                                                        </div>
                                                    )}
                                                    {goal.projects.map(
                                                        (proj) => {
                                                            const projK = `${goalK}/proj:${proj.key}`;
                                                            const isReal =
                                                                proj.key !==
                                                                NO_PROJECT;
                                                            const wholeLinked =
                                                                linkedProjectSet.has(
                                                                    proj.key
                                                                );
                                                            return (
                                                                <div
                                                                    key={projK}
                                                                >
                                                                    <div className="flex items-center gap-1 pl-5">
                                                                        {isReal && (
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={
                                                                                    wholeLinked
                                                                                }
                                                                                disabled={
                                                                                    readOnly
                                                                                }
                                                                                title={t(
                                                                                    'goalshq.linkWholeProjectHint',
                                                                                    'Auto-achieve when every active task in this project is done'
                                                                                )}
                                                                                onChange={() =>
                                                                                    onToggleProject(
                                                                                        proj.key
                                                                                    )
                                                                                }
                                                                            />
                                                                        )}
                                                                        {header(
                                                                            projK,
                                                                            proj.label,
                                                                            '',
                                                                            proj.status &&
                                                                                isReal ? (
                                                                                <span
                                                                                    className={`ml-1 rounded border px-1 py-px text-[10px] uppercase leading-none ${projStatusChipCls(
                                                                                        proj.status
                                                                                    )}`}
                                                                                >
                                                                                    {
                                                                                        proj.status
                                                                                    }
                                                                                </span>
                                                                            ) : undefined,
                                                                            {
                                                                                linked: proj.leaves.filter(
                                                                                    (
                                                                                        l
                                                                                    ) =>
                                                                                        l.linked ||
                                                                                        wholeLinked
                                                                                )
                                                                                    .length,
                                                                                total: proj
                                                                                    .leaves
                                                                                    .length,
                                                                            }
                                                                        )}
                                                                    </div>
                                                                    {openGroups.has(
                                                                        projK
                                                                    ) && (
                                                                        <div className="pl-10">
                                                                            {proj.leaves.map(
                                                                                (
                                                                                    l
                                                                                ) =>
                                                                                    renderLeaf(
                                                                                        l,
                                                                                        wholeLinked
                                                                                    )
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        }
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MilestoneTriggerTasks;
