import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FlagIcon,
    Squares2X2Icon,
    SwatchIcon,
    ChartBarIcon,
    CheckIcon,
    ChevronDownIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import ColorPicker from '../Shared/ColorPicker';
import CollapsibleFields from '../Shared/CollapsibleFields';
import { useToast } from '../Shared/ToastContext';
import { Strategy, StrategyStatus } from '../../entities/Strategy';
import {
    createStrategy,
    updateStrategy,
    deleteStrategy,
    fetchGoalshqGoals,
} from '../../utils/goalsHqService';
import { fetchProjects } from '../../utils/projectsService';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** existing strategy to edit, or null to create */
    strategy?: Strategy | null;
    /** preselect a goal when creating from a goal page */
    defaultGoalUid?: string | null;
    onSaved: (strategy: Strategy) => void;
    onDeleted?: (uid: string) => void;
}

const STATUSES: StrategyStatus[] = ['active', 'paused', 'achieved', 'dropped'];

const StrategyModal: React.FC<Props> = ({
    isOpen,
    onClose,
    strategy,
    defaultGoalUid,
    onSaved,
    onDeleted,
}) => {
    const { t } = useTranslation();
    const { showErrorToast, showSuccessToast } = useToast();
    const nameRef = useRef<HTMLInputElement>(null);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState('');
    const [status, setStatus] = useState<StrategyStatus>('active');
    const [metricsEditable, setMetricsEditable] = useState(true);
    const [goalUid, setGoalUid] = useState<string>('');
    const [projectUids, setProjectUids] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

    const [goals, setGoals] = useState<{ uid: string; title: string }[]>([]);
    const [projects, setProjects] = useState<{ uid: string; name: string }[]>(
        []
    );

    useEffect(() => {
        if (!isOpen) return;
        setName(strategy?.name || '');
        setDescription(strategy?.description || '');
        setColor(strategy?.color || '');
        setStatus(strategy?.status || 'active');
        setMetricsEditable(strategy ? strategy.metrics_editable : true);
        setGoalUid(strategy?.goal?.uid || defaultGoalUid || '');
        setProjectUids((strategy?.projects || []).map((p) => p.uid));
        setTimeout(() => nameRef.current?.focus(), 60);

        fetchGoalshqGoals()
            .then((g) =>
                setGoals(g.map((x) => ({ uid: x.uid, title: x.title })))
            )
            .catch(() => setGoals([]));
        fetchProjects('all', '')
            .then((p) =>
                setProjects(
                    (p || [])
                        .filter((x) => x && x.uid)
                        .map((x) => ({ uid: x.uid as string, name: x.name }))
                )
            )
            .catch(() => setProjects([]));
    }, [isOpen, strategy, defaultGoalUid]);

    if (!isOpen) return null;

    const isEdit = !!strategy;

    const toggleProject = (uid: string) =>
        setProjectUids((prev) =>
            prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]
        );

    const selectedNames = projects
        .filter((p) => projectUids.includes(p.uid))
        .map((p) => p.name);

    const handleSubmit = async () => {
        if (!name.trim()) {
            showErrorToast(
                t('goalshq.strategyNameRequired', 'Name is required')
            );
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                name: name.trim(),
                description: description.trim() || null,
                color: color || null,
                status,
                metrics_editable: metricsEditable,
                goal_uid: goalUid || null,
            };
            const saved =
                isEdit && strategy
                    ? await updateStrategy(strategy.uid, {
                          ...payload,
                          project_uids: projectUids,
                      })
                    : await createStrategy({
                          ...payload,
                          project_uids: projectUids,
                      });
            showSuccessToast(
                isEdit
                    ? t('goalshq.strategyUpdated', 'Strategy updated')
                    : t('goalshq.strategyCreated', 'Strategy created')
            );
            onSaved(saved);
            onClose();
        } catch (e) {
            showErrorToast((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!strategy) return;
        try {
            await deleteStrategy(strategy.uid);
            showSuccessToast(t('goalshq.strategyDeleted', 'Strategy deleted'));
            onDeleted?.(strategy.uid);
            onClose();
        } catch (e) {
            showErrorToast((e as Error).message);
        }
    };

    const inputCls =
        'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500';

    return (
        <div className="fixed inset-0 top-16 z-40 flex items-start justify-center overflow-y-auto bg-gray-900/70 p-4">
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-800">
                <div className="border-b border-gray-200 px-4 pt-4 pb-3 dark:border-gray-700">
                    <input
                        ref={nameRef}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t(
                            'goalshq.strategyNamePlaceholder',
                            'Strategy name'
                        )}
                        className="block w-full border-none bg-transparent text-xl font-semibold text-black focus:outline-none dark:text-white"
                    />
                </div>

                <div className="px-4 py-3">
                    <textarea
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t(
                            'goalshq.strategyDescriptionPlaceholder',
                            'What this groups together…'
                        )}
                        className={`${inputCls} resize-none`}
                    />
                </div>

                <div className="px-4 pb-2">
                    <CollapsibleFields
                        fields={[
                            {
                                key: 'goal',
                                icon: <FlagIcon />,
                                label: t('forms.goalArea', 'Goal'),
                                filled: !!goalUid,
                                render: () => (
                                    <select
                                        value={goalUid}
                                        onChange={(e) =>
                                            setGoalUid(e.target.value)
                                        }
                                        className={inputCls}
                                    >
                                        <option value="">
                                            {t('goalshq.noGoal', 'No goal')}
                                        </option>
                                        {goals.map((g) => (
                                            <option key={g.uid} value={g.uid}>
                                                {g.title}
                                            </option>
                                        ))}
                                    </select>
                                ),
                            },
                            {
                                key: 'projects',
                                icon: <Squares2X2Icon />,
                                label: t('goalshq.linkedProjects', 'Projects'),
                                filled: projectUids.length > 0,
                                render: () => (
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setProjectDropdownOpen(
                                                    (v) => !v
                                                )
                                            }
                                            className={`flex w-full items-center justify-between gap-2 ${inputCls}`}
                                        >
                                            <span className="truncate text-left">
                                                {selectedNames.length === 0
                                                    ? t(
                                                          'goalshq.noProjectsSelected',
                                                          'No projects selected'
                                                      )
                                                    : selectedNames.join(', ')}
                                            </span>
                                            <ChevronDownIcon
                                                className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                                                    projectDropdownOpen
                                                        ? 'rotate-180'
                                                        : ''
                                                }`}
                                            />
                                        </button>
                                        {projectDropdownOpen && (
                                            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
                                                {projects.length === 0 ? (
                                                    <p className="px-3 py-2.5 text-sm text-gray-400">
                                                        {t(
                                                            'goalshq.noAvailableProjects',
                                                            'No projects'
                                                        )}
                                                    </p>
                                                ) : (
                                                    projects.map((p) => {
                                                        const checked =
                                                            projectUids.includes(
                                                                p.uid
                                                            );
                                                        return (
                                                            <button
                                                                key={p.uid}
                                                                type="button"
                                                                onClick={() =>
                                                                    toggleProject(
                                                                        p.uid
                                                                    )
                                                                }
                                                                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                                                            >
                                                                <span
                                                                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                                                                        checked
                                                                            ? 'border-blue-600 bg-blue-600'
                                                                            : 'border-gray-300 dark:border-gray-500'
                                                                    }`}
                                                                >
                                                                    {checked && (
                                                                        <CheckIcon className="h-3 w-3 text-white" />
                                                                    )}
                                                                </span>
                                                                <span className="truncate text-sm text-gray-800 dark:text-gray-200">
                                                                    {p.name}
                                                                </span>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ),
                            },
                            {
                                key: 'color',
                                icon: <SwatchIcon />,
                                label: t('forms.color', 'Colour'),
                                filled: !!color,
                                render: () => (
                                    <ColorPicker
                                        value={color}
                                        onChange={(c) => setColor(c || '')}
                                    />
                                ),
                            },
                            {
                                key: 'status',
                                icon: <ChartBarIcon />,
                                label: t('goalshq.status', 'Status & metrics'),
                                filled: status !== 'active' || !metricsEditable,
                                render: () => (
                                    <div className="space-y-3">
                                        <select
                                            value={status}
                                            onChange={(e) =>
                                                setStatus(
                                                    e.target
                                                        .value as StrategyStatus
                                                )
                                            }
                                            className={inputCls}
                                        >
                                            {STATUSES.map((s) => (
                                                <option key={s} value={s}>
                                                    {t(
                                                        `goalshq.strategyStatus.${s}`,
                                                        s
                                                    )}
                                                </option>
                                            ))}
                                        </select>
                                        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={metricsEditable}
                                                onChange={(e) =>
                                                    setMetricsEditable(
                                                        e.target.checked
                                                    )
                                                }
                                            />
                                            {t(
                                                'goalshq.metricsEditable',
                                                'Key Results are editable'
                                            )}
                                        </label>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        {isEdit && onDeleted && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="rounded-md border border-red-300 p-2 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                                title={t('common.delete', 'Delete')}
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                    </div>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={handleSubmit}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isEdit
                            ? t('common.update', 'Update')
                            : t('common.create', 'Create')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StrategyModal;
