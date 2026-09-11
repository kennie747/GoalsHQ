import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    TrashIcon,
    PaperClipIcon,
    ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import {
    GoalshqRecord,
    RecordInput,
    RecordTemplate,
} from '../../entities/Record';
import { KeyResult } from '../../entities/KeyResult';
import {
    fetchRecords,
    createRecord,
    deleteRecord,
} from '../../utils/goalsHqService';
import {
    uploadAttachmentTo,
    getDownloadUrl,
} from '../../utils/attachmentsService';
import { useToast } from '../Shared/ToastContext';
import DeleteConfirmDialog from '../Shared/DeleteConfirmDialog';

interface Props {
    parentType: 'goal' | 'strategy' | 'project';
    parentUid: string;
    keyResults: KeyResult[];
}

const inputCls =
    'rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';

const templateCols: Record<RecordTemplate, string[]> = {
    ledger: ['record_date', 'title', 'amount', 'counts', 'evidence'],
    build: ['record_date', 'title', 'category', 'status'],
    register: ['record_date', 'title', 'category', 'status', 'evidence'],
};

const today = () => new Date().toISOString().slice(0, 10);

const RecordsPanel: React.FC<Props> = ({
    parentType,
    parentUid,
    keyResults,
}) => {
    const { t } = useTranslation();
    const { showErrorToast } = useToast();
    const [records, setRecords] = useState<GoalshqRecord[] | null>(null);
    const [template, setTemplate] = useState<RecordTemplate>('ledger');
    const [showMore, setShowMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<RecordInput>({ record_date: today() });
    const [files, setFiles] = useState<File[]>([]);
    const [deleting, setDeleting] = useState<GoalshqRecord | null>(null);

    const load = useCallback(async () => {
        try {
            setRecords(await fetchRecords(parentType, parentUid));
        } catch {
            setRecords([]);
        }
    }, [parentType, parentUid]);

    useEffect(() => {
        load();
    }, [load]);

    const add = async () => {
        if (!draft.title?.trim()) return;
        setBusy(true);
        try {
            const rec = await createRecord(parentType, parentUid, {
                ...draft,
                record_date: draft.record_date || today(),
            });
            for (const f of files) {
                // eslint-disable-next-line no-await-in-loop
                await uploadAttachmentTo('goalshq_record', rec.uid, f);
            }
            setDraft({ record_date: today() });
            setFiles([]);
            setShowMore(false);
            load();
        } catch (e) {
            showErrorToast((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const cols = templateCols[template];
    const krName = (kruid: string | null) =>
        keyResults.find((k) => k.uid === kruid)?.name || null;

    return (
        <div>
            {deleting && (
                <DeleteConfirmDialog
                    itemLabel={deleting.title}
                    extra={t(
                        'goalshq.deleteRecordExtra',
                        'Any evidence files attached to it are deleted too.'
                    )}
                    onCancel={() => setDeleting(null)}
                    onConfirm={async () => {
                        try {
                            await deleteRecord(deleting.uid);
                        } catch (e) {
                            showErrorToast((e as Error).message);
                        }
                        setDeleting(null);
                        load();
                    }}
                />
            )}
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('goalshq.records', 'Records')}
                </h3>
                <select
                    value={template}
                    onChange={(e) =>
                        setTemplate(e.target.value as RecordTemplate)
                    }
                    className={inputCls}
                >
                    <option value="ledger">
                        {t('goalshq.tplLedger', 'Contribution Ledger')}
                    </option>
                    <option value="build">
                        {t('goalshq.tplBuild', 'Build Log')}
                    </option>
                    <option value="register">
                        {t('goalshq.tplRegister', 'Register')}
                    </option>
                </select>
            </div>

            {/* Add row — minimal by default */}
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={draft.record_date || ''}
                        onChange={(e) =>
                            setDraft({ ...draft, record_date: e.target.value })
                        }
                        className={inputCls}
                    />
                    <input
                        placeholder={t('goalshq.recordTitle', 'Title')}
                        value={draft.title || ''}
                        onChange={(e) =>
                            setDraft({ ...draft, title: e.target.value })
                        }
                        className={`${inputCls} min-w-[150px] flex-1`}
                    />
                    <input
                        placeholder={t('goalshq.amount', 'Amount')}
                        value={draft.amount ?? ''}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                amount: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                            })
                        }
                        className={`${inputCls} w-24`}
                    />
                    <button
                        disabled={busy}
                        onClick={add}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.add', 'Add')}
                    </button>
                    <button
                        onClick={() => setShowMore((v) => !v)}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    >
                        {t('goalshq.more', '⋯ more')}
                    </button>
                </div>
                {showMore && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input
                            placeholder={t('goalshq.unit', 'Unit')}
                            value={draft.unit || ''}
                            onChange={(e) =>
                                setDraft({ ...draft, unit: e.target.value })
                            }
                            className={inputCls}
                        />
                        <input
                            placeholder={t(
                                'goalshq.categoryStatus',
                                'Category / status'
                            )}
                            value={draft.category || ''}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    category: e.target.value,
                                })
                            }
                            className={inputCls}
                        />
                        <select
                            value={draft.counts_toward_kr_uid || ''}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    counts_toward_kr_uid:
                                        e.target.value || null,
                                })
                            }
                            className={inputCls}
                        >
                            <option value="">
                                {t('goalshq.countsToward', 'Counts toward KR…')}
                            </option>
                            {keyResults.map((k) => (
                                <option key={k.uid} value={k.uid}>
                                    {k.name}
                                </option>
                            ))}
                        </select>
                        <input
                            placeholder={t(
                                'goalshq.evidenceUrl',
                                'Evidence link (URL)'
                            )}
                            value={draft.evidence_url || ''}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    evidence_url: e.target.value,
                                })
                            }
                            className={inputCls}
                        />
                        <label className="col-span-full flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
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
                            {files.length > 0 && (
                                <span className="text-xs text-gray-400">
                                    {files.length} selected
                                </span>
                            )}
                        </label>
                        <textarea
                            placeholder={t('goalshq.note', 'Note (markdown)')}
                            value={draft.body || ''}
                            onChange={(e) =>
                                setDraft({ ...draft, body: e.target.value })
                            }
                            rows={2}
                            className={`${inputCls} col-span-full resize-none`}
                        />
                    </div>
                )}
            </div>

            {/* List */}
            {records === null ? (
                <p className="text-xs text-gray-400">
                    {t('common.loading', 'Loading...')}
                </p>
            ) : records.length === 0 ? (
                <p className="text-xs text-gray-400">
                    {t('goalshq.noRecords', 'No records yet.')}
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-400">
                                <th className="py-1 pr-3">
                                    {t('goalshq.date', 'Date')}
                                </th>
                                <th className="py-1 pr-3">
                                    {t('goalshq.recordTitle', 'Title')}
                                </th>
                                {cols.includes('amount') && (
                                    <th className="py-1 pr-3">
                                        {t('goalshq.amount', 'Amount')}
                                    </th>
                                )}
                                {cols.includes('category') && (
                                    <th className="py-1 pr-3">
                                        {t('goalshq.category', 'Category')}
                                    </th>
                                )}
                                {cols.includes('status') && (
                                    <th className="py-1 pr-3">
                                        {t('goalshq.status', 'Status')}
                                    </th>
                                )}
                                {cols.includes('counts') && (
                                    <th className="py-1 pr-3">
                                        {t('goalshq.countsShort', 'Counts →')}
                                    </th>
                                )}
                                <th className="py-1 pr-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((r) => (
                                <tr
                                    key={r.uid}
                                    className="border-t border-gray-100 dark:border-gray-700/60"
                                >
                                    <td className="py-1.5 pr-3 text-gray-500">
                                        {r.record_date}
                                    </td>
                                    <td className="py-1.5 pr-3 text-gray-800 dark:text-gray-100">
                                        {r.title}
                                        {(r.attachments.length > 0 ||
                                            r.evidence_url) && (
                                            <span className="ml-2 inline-flex gap-1 align-middle">
                                                {r.attachments.map((a) => (
                                                    <a
                                                        key={a.uid}
                                                        href={getDownloadUrl(
                                                            a.uid
                                                        )}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        title={
                                                            a.original_filename
                                                        }
                                                        className="text-gray-400 hover:text-blue-500"
                                                    >
                                                        <ArrowDownTrayIcon className="inline h-3.5 w-3.5" />
                                                    </a>
                                                ))}
                                                {r.evidence_url && (
                                                    <a
                                                        href={r.evidence_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-xs text-blue-500 hover:underline"
                                                    >
                                                        link
                                                    </a>
                                                )}
                                            </span>
                                        )}
                                        {r.body && (
                                            <div className="text-xs text-gray-400">
                                                {r.body}
                                            </div>
                                        )}
                                    </td>
                                    {cols.includes('amount') && (
                                        <td className="py-1.5 pr-3 tabular-nums">
                                            {r.amount == null
                                                ? '—'
                                                : `${r.amount}${r.unit ? ' ' + r.unit : ''}`}
                                        </td>
                                    )}
                                    {cols.includes('category') && (
                                        <td className="py-1.5 pr-3 text-gray-500">
                                            {r.category || '—'}
                                        </td>
                                    )}
                                    {cols.includes('status') && (
                                        <td className="py-1.5 pr-3 text-gray-500">
                                            {r.status || '—'}
                                        </td>
                                    )}
                                    {cols.includes('counts') && (
                                        <td className="py-1.5 pr-3 text-gray-500">
                                            {krName(r.counts_toward_kr_uid) ||
                                                '—'}
                                        </td>
                                    )}
                                    <td className="py-1.5">
                                        <button
                                            onClick={() => setDeleting(r)}
                                            className="text-gray-400 hover:text-red-500"
                                        >
                                            <TrashIcon className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default RecordsPanel;
