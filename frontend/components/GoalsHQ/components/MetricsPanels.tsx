import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrashIcon } from '@heroicons/react/24/outline';
import {
    KeyResult,
    Milestone,
    ParentType,
    KeyResultDirection,
} from '../../../entities/GoalsHq';
import {
    createKeyResult,
    updateKeyResult,
    deleteKeyResult,
    createMilestone,
    updateMilestone,
    deleteMilestone,
} from '../../../utils/goalsHqService';

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
        baseline_value: '0',
        target_value: '',
        current_value: '0',
    });
    const [msDraft, setMsDraft] = useState({ title: '', target_date: '' });
    const [busy, setBusy] = useState(false);

    const addKr = async () => {
        if (!krDraft.name.trim() || krDraft.target_value === '') return;
        setBusy(true);
        try {
            await createKeyResult(parentType, parentUid, {
                name: krDraft.name.trim(),
                unit: krDraft.unit || null,
                direction: krDraft.direction,
                baseline_value: Number(krDraft.baseline_value || 0),
                target_value: Number(krDraft.target_value),
                current_value: Number(krDraft.current_value || 0),
            });
            setKrDraft({
                name: '',
                unit: '',
                direction: 'increase',
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
        await updateKeyResult(krNumericId(kr), { current_value: value });
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
        await updateMilestone(msNumericId(m), {
            status: m.status === 'achieved' ? 'pending' : 'achieved',
        });
        onChange();
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
                            <input
                                type="number"
                                defaultValue={kr.current_value}
                                onBlur={(e) =>
                                    patchKrCurrent(kr, Number(e.target.value))
                                }
                                className={`${inputCls} w-20`}
                            />
                            <span className="text-gray-400">
                                / {kr.target_value} {kr.unit || ''}
                            </span>
                            <button
                                aria-label={t('common.delete', 'Delete')}
                                onClick={async () => {
                                    await deleteKeyResult(krNumericId(kr));
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
                            <button
                                aria-label={t('common.delete', 'Delete')}
                                onClick={async () => {
                                    await deleteMilestone(msNumericId(m));
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

// The API addresses key results / milestones by uid; older callers used a
// numeric id. Keep a single shim so a future switch is one edit.
function krNumericId(kr: KeyResult): any {
    return kr.uid;
}
function msNumericId(m: Milestone): any {
    return m.uid;
}

export default MetricsPanels;
