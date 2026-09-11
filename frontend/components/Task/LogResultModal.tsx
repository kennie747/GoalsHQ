import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PaperClipIcon } from '@heroicons/react/24/outline';
import { KeyResult } from '../../entities/KeyResult';
import {
    createRecord,
    fetchGoalshqGoal,
    fetchGoalshqProject,
} from '../../utils/goalsHqService';
import { uploadAttachmentTo } from '../../utils/attachmentsService';
import { useToast } from '../Shared/ToastContext';

interface Props {
    taskUid: string;
    taskName: string;
    projectUid: string;
    goalUid?: string | null;
    onClose: () => void;
}

const inputCls =
    'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

/**
 * Optional, dismissible "Log a result?" prompt shown after a task with a
 * project is completed (when GoalsHQ is enabled). Creates a task-linked Record
 * on the task's project, optionally pointed at a KR + with evidence files.
 */
const LogResultModal: React.FC<Props> = ({
    taskUid,
    taskName,
    projectUid,
    goalUid,
    onClose,
}) => {
    const { t } = useTranslation();
    const { showSuccessToast, showErrorToast } = useToast();
    const [value, setValue] = useState('');
    const [unit, setUnit] = useState('');
    const [showMore, setShowMore] = useState(false);
    const [note, setNote] = useState('');
    const [evidenceUrl, setEvidenceUrl] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [krUid, setKrUid] = useState('');
    const [krs, setKrs] = useState<KeyResult[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            const krList: KeyResult[] = [];
            try {
                const project = await fetchGoalshqProject(projectUid);
                krList.push(...(project?.key_results || []));
            } catch {
                /* ignore */
            }
            if (goalUid) {
                try {
                    const goal = await fetchGoalshqGoal(goalUid);
                    krList.push(...(goal.key_results || []));
                } catch {
                    /* ignore */
                }
            }
            setKrs(krList);
        })();
    }, [projectUid, goalUid]);

    const submit = async () => {
        setBusy(true);
        try {
            const rec = await createRecord('project', projectUid, {
                title: taskName,
                amount: value ? Number(value) : null,
                unit: unit || null,
                body: note || null,
                evidence_url: evidenceUrl || null,
                counts_toward_kr_uid: krUid || null,
                task_uid: taskUid,
            });
            for (const f of files) {
                // eslint-disable-next-line no-await-in-loop
                await uploadAttachmentTo('goalshq_record', rec.uid, f);
            }
            showSuccessToast(t('goalshq.resultLogged', 'Result logged'));
            onClose();
        } catch (e) {
            showErrorToast((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 top-16 z-50 flex items-start justify-center bg-gray-900/60 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {t('goalshq.logAResult', 'Log a result?')}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-xs text-gray-400 hover:text-gray-600"
                    >
                        ✕
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-500">
                        {t('goalshq.value', 'Value')}
                        <input
                            autoFocus
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className={inputCls}
                        />
                    </label>
                    <label className="text-xs text-gray-500">
                        {t('goalshq.unit', 'Unit')}
                        <input
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                            className={inputCls}
                        />
                    </label>
                </div>
                <button
                    onClick={() => setShowMore((v) => !v)}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                >
                    {t('goalshq.more', '⋯ more')} (note · KR · evidence)
                </button>
                {showMore && (
                    <div className="mt-2 space-y-2">
                        <input
                            placeholder={t('goalshq.note', 'Note')}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className={inputCls}
                        />
                        {krs.length > 0 && (
                            <select
                                value={krUid}
                                onChange={(e) => setKrUid(e.target.value)}
                                className={inputCls}
                            >
                                <option value="">
                                    {t(
                                        'goalshq.countsToward',
                                        'Counts toward KR…'
                                    )}
                                </option>
                                {krs.map((k) => (
                                    <option key={k.uid} value={k.uid}>
                                        {k.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        <input
                            placeholder={t(
                                'goalshq.evidenceUrl',
                                'Evidence link (URL)'
                            )}
                            value={evidenceUrl}
                            onChange={(e) => setEvidenceUrl(e.target.value)}
                            className={inputCls}
                        />
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                            <PaperClipIcon className="h-4 w-4" />
                            {t('goalshq.evidenceFiles', 'Evidence files')}
                            <input
                                type="file"
                                multiple
                                onChange={(e) =>
                                    setFiles(Array.from(e.target.files || []))
                                }
                                className="text-xs"
                            />
                        </label>
                    </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="text-sm text-gray-500 hover:text-gray-700"
                    >
                        {t('common.skip', 'Skip')}
                    </button>
                    <button
                        disabled={busy}
                        onClick={submit}
                        className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('goalshq.logResult', 'Log result')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LogResultModal;
