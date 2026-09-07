import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrashIcon, ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { ParentType } from '../../entities/GoalSettings';
import {
    KeyResult,
    KeyResultDirection,
    KeyResultAutoSource,
} from '../../entities/KeyResult';
import { Milestone } from '../../entities/Milestone';
import {
    createKeyResult,
    updateKeyResult,
    deleteKeyResult,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    expandMilestone,
} from '../../utils/goalsHqService';

interface Props {
    parentType: ParentType;
    parentUid: string;
    keyResults: KeyResult[];
    milestones: Milestone[];
    onChange: () => void;
}

const inputCls =
    'rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

const MetricsPanels: React.FC<Props> = ({
    parentType,
    parentUid,
    keyResults,
    milestones,
    onChange,
}) => {
    const { t } = useTranslation();
    const [krDraft, setKrDraft] = useState({
        name: '',
        unit: '',
        direction: 'increase' as KeyResultDirection,
        auto_source: 'manual' as KeyResultAutoSource,
        baseline_value: '0',
        target_value: '',
        current_value: '0',
    });
    const [msDraft, setMsDraft] = useState({ title: '', target_date: '' });
    const [busy, setBusy] = useState(false);
    const [expandedUids, setExpandedUids] = useState<Set<string>>(new Set());

    const addKr = async () => {
        if (!krDraft.name.trim() || krDraft.target_value === '') return;
        setBusy(true);
        try {
            await createKeyResult(parentType, parentUid, {
                name: krDraft.name.trim(),
                unit: krDraft.unit || null,
                direction: krDraft.direction,
                auto_source: krDraft.auto_source,
                baseline_value: Number(krDraft.baseline_value || 0),
                target_value: Number(krDraft.target_value),
                current_value: Number(krDraft.current_value || 0),
            });
            setKrDraft({
                name: '',
                unit: '',
                direction: 'increase',
                auto_source: 'manual',
                baseline_value: '0',
                target_value: '',
                current_value: '0',
            });
            onChange();
        } finally {
            setBusy(false);
        }
    };

    const patchKrCurrent = async (kr: KeyResult, value: number) => {
        await updateKeyResult(kr.uid, { current_value: value });
        onChange();
    };

    const toggleKrAutoSource = async (kr: KeyResult) => {
        await updateKeyResult(kr.uid, {
            auto_source:
                kr.auto_source === 'tasks_done_count'
                    ? 'manual'
                    : 'tasks_done_count',
        });
        onChange();
    };

    const addMs = async () => {
        if (!msDraft.title.trim()) return;
        setBusy(true);
        try {
            await createMilestone(parentType, parentUid, {
                title: msDraft.title.trim(),
                target_date: msDraft.target_date || null,
            });
            setMsDraft({ title: '', target_date: '' });
            onChange();
        } finally {
            setBusy(false);
        }
    };

    const toggleMs = async (m: Milestone) => {
        await updateMilestone(m.uid, {
            status: m.status === 'achieved' ? 'pending' : 'achieved',
        });
        onChange();
    };

    const expandMs = async (m: Milestone) => {
        await expandMilestone(m.uid);
        setExpandedUids((prev) => new Set(prev).add(m.uid));
    };

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Key results */}
            <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('goalshq.keyResults', 'Key results')}
                </h3>
                <ul className="mb-3 space-y-2">
                    {keyResults.map((kr) => (
                        <li
                            key={kr.uid}
                            className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-700"
                        >
                            <span className="flex-1 text-gray-800 dark:text-gray-100">
                                {kr.name}
                            </span>
                            {kr.auto_source === 'tasks_done_count' ? (
                                <span
                                    className={`${inputCls} w-20 text-center text-gray-500 dark:text-gray-400`}
                                    title={t(
                                        'goalshq.krAutoValueHint',
                                        'Auto-updated from done task count'
                                    )}
                                >
                                    {kr.current_value}
                                </span>
                            ) : (
                                <input
                                    type="number"
                                    defaultValue={kr.current_value}
                                    onBlur={(e) =>
                                        patchKrCurrent(
                                            kr,
                                            Number(e.target.value)
                                        )
                                    }
                                    className={`${inputCls} w-20`}
                                />
                            )}
                            <span className="text-gray-400">
                                / {kr.target_value} {kr.unit || ''}
                            </span>
                            <button
                                onClick={() => toggleKrAutoSource(kr)}
                                className={`rounded px-1.5 py-0.5 text-xs ${
                                    kr.auto_source === 'tasks_done_count'
                                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                                }`}
                                title={t(
                                    'goalshq.krToggleAutoHint',
                                    'Toggle auto-update from done task count'
                                )}
                            >
                                {t('goalshq.krAuto', 'auto')}
                            </button>
                            <button
                                aria-label={t('common.delete', 'Delete')}
                                onClick={async () => {
                                    await deleteKeyResult(kr.uid);
                                    onChange();
                                }}
                                className="text-gray-400 hover:text-red-500"
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {keyResults.length === 0 && (
                        <li className="text-xs text-gray-400">
                            {t('goalshq.noKeyResults', 'No key results yet.')}
                        </li>
                    )}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        placeholder={t('goalshq.krName', 'Metric name')}
                        value={krDraft.name}
                        onChange={(e) =>
                            setKrDraft({ ...krDraft, name: e.target.value })
                        }
                        className={`${inputCls} flex-1`}
                    />
                    <input
                        placeholder={t('goalshq.krTarget', 'Target')}
                        type="number"
                        value={krDraft.target_value}
                        onChange={(e) =>
                            setKrDraft({
                                ...krDraft,
                                target_value: e.target.value,
                            })
                        }
                        className={`${inputCls} w-24`}
                    />
                    <button
                        disabled={busy}
                        onClick={addKr}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.add', 'Add')}
                    </button>
                </div>
            </section>

            {/* Milestones */}
            <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('goalshq.milestones', 'Milestones')}
                </h3>
                <ul className="mb-3 space-y-2">
                    {milestones.map((m) => (
                        <li
                            key={m.uid}
                            className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm dark:border-gray-700"
                        >
                            <input
                                type="checkbox"
                                checked={m.status === 'achieved'}
                                onChange={() => toggleMs(m)}
                            />
                            <span
                                className={`flex-1 ${
                                    m.status === 'achieved'
                                        ? 'text-gray-400 line-through'
                                        : 'text-gray-800 dark:text-gray-100'
                                }`}
                            >
                                {m.title}
                            </span>
                            {m.target_date && (
                                <span className="text-xs text-gray-400">
                                    {m.target_date}
                                </span>
                            )}
                            {expandedUids.has(m.uid) ? (
                                <span className="text-xs text-green-600 dark:text-green-400">
                                    {t('goalshq.msExpanded', 'Task created')}
                                </span>
                            ) : (
                                <button
                                    aria-label={t(
                                        'goalshq.msExpand',
                                        'Expand into task'
                                    )}
                                    title={t(
                                        'goalshq.msExpand',
                                        'Expand into task'
                                    )}
                                    onClick={() => expandMs(m)}
                                    className="text-gray-400 hover:text-blue-500"
                                >
                                    <ArrowRightCircleIcon className="h-4 w-4" />
                                </button>
                            )}
                            <button
                                aria-label={t('common.delete', 'Delete')}
                                onClick={async () => {
                                    await deleteMilestone(m.uid);
                                    onChange();
                                }}
                                className="text-gray-400 hover:text-red-500"
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                    {milestones.length === 0 && (
                        <li className="text-xs text-gray-400">
                            {t('goalshq.noMilestones', 'No milestones yet.')}
                        </li>
                    )}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        placeholder={t('goalshq.msTitle', 'Milestone')}
                        value={msDraft.title}
                        onChange={(e) =>
                            setMsDraft({ ...msDraft, title: e.target.value })
                        }
                        className={`${inputCls} flex-1`}
                    />
                    <input
                        type="date"
                        value={msDraft.target_date}
                        onChange={(e) =>
                            setMsDraft({
                                ...msDraft,
                                target_date: e.target.value,
                            })
                        }
                        className={`${inputCls}`}
                    />
                    <button
                        disabled={busy}
                        onClick={addMs}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.add', 'Add')}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default MetricsPanels;
