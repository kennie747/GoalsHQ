import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../Shared/ToastContext';
import {
    ArrowDownTrayIcon,
    ArrowUpTrayIcon,
    TableCellsIcon,
    ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
    dataExchangeService,
    DataExchangeJob,
    ExchangeFormat,
    ImportMode,
    PlanResult,
    ResourceDescriptor,
} from '../../utils/dataExchangeService';

type TabType = 'export' | 'import';

const DataExchange: React.FC = () => {
    const { t } = useTranslation();
    const { showSuccessToast, showErrorToast } = useToast();

    const [tab, setTab] = useState<TabType>('export');
    const [resources, setResources] = useState<ResourceDescriptor[]>([]);
    const [format, setFormat] = useState<ExchangeFormat>('xlsx');
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const [file, setFile] = useState<File | null>(null);
    const [plan, setPlan] = useState<PlanResult | null>(null);
    const [mode, setMode] = useState<ImportMode>('merge');
    const [syncScopes, setSyncScopes] = useState<string[]>([]);
    const [syncDelete, setSyncDelete] = useState<'archive' | 'destroy'>(
        'archive'
    );
    const [history, setHistory] = useState<DataExchangeJob[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshHistory = () => {
        dataExchangeService
            .listJobs(10)
            .then(setHistory)
            .catch(() => {
                /* history is a nice-to-have; fail silently */
            });
    };

    useEffect(() => {
        dataExchangeService
            .listResources()
            .then((res) => {
                setResources(res.resources);
                setSelected(res.resources.map((r) => r.key));
            })
            .catch(() =>
                showErrorToast(
                    t('dataExchange.loadError', 'Failed to load metadata')
                )
            );
        refreshHistory();
        // refreshHistory intentionally omitted: it has no external deps and
        // re-running it on every render would be wasteful.
    }, [showErrorToast, t]);

    // CSV = single entity.
    useEffect(() => {
        if (format === 'csv' && selected.length !== 1) {
            setSelected((prev) => (prev.length ? [prev[0]] : []));
        }
    }, [format, selected.length]);

    const scopeForRequest = useMemo(
        () => (selected.length === resources.length ? [] : selected),
        [selected, resources.length]
    );

    const toggleScope = (key: string) => {
        setSelected((prev) => {
            if (format === 'csv') return [key];
            return prev.includes(key)
                ? prev.filter((k) => k !== key)
                : [...prev, key];
        });
    };

    // Export/template downloads and import commits all get logged server-side;
    // refreshing after any successful action keeps the history panel current
    // without needing per-call bookkeeping.
    const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
        setBusy(true);
        try {
            await fn();
            if (okMsg) showSuccessToast(okMsg);
            refreshHistory();
        } catch (e) {
            showErrorToast(e instanceof Error ? e.message : 'Request failed');
        } finally {
            setBusy(false);
        }
    };

    const handleFile = (f: File | null) => {
        setFile(f);
        setPlan(null);
    };

    const doPreview = () =>
        run(async () => {
            if (!file) return;
            const result = await dataExchangeService.previewImport(
                file,
                format,
                scopeForRequest,
                { mode, syncScopes }
            );
            setPlan(result);
        });

    const doCommit = () =>
        run(async () => {
            if (!file || !plan) return;
            const result = await dataExchangeService.commitImport(
                file,
                format,
                scopeForRequest,
                {
                    mode,
                    syncScopes,
                    syncDelete,
                    confirmDeletes: plan.totals.pendingDeletes,
                }
            );
            setPlan(result);
            showSuccessToast(
                t(
                    'dataExchange.importDone',
                    'Import complete: {{c}} created, {{u}} updated',
                    {
                        c: result.totals.created,
                        u: result.totals.updated,
                    }
                )
            );
        });

    const hasErrors = (plan?.totals.errors ?? 0) > 0;

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <TableCellsIcon className="h-7 w-7" />
                    {t('dataExchange.title', 'Spreadsheet Import & Export')}
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {t(
                        'dataExchange.description',
                        'Download a template, fill it in, and upload it back. Re-uploading an export makes no changes unless you edited it.'
                    )}
                </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
                <div className="border-b border-gray-200 dark:border-gray-700 flex">
                    {(['export', 'import'] as TabType[]).map((tb) => (
                        <button
                            key={tb}
                            data-testid={`tab-${tb}`}
                            onClick={() => setTab(tb)}
                            className={`flex-1 px-6 py-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
                                tab === tb
                                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                        >
                            {tb === 'export' ? (
                                <ArrowDownTrayIcon className="h-5 w-5" />
                            ) : (
                                <ArrowUpTrayIcon className="h-5 w-5" />
                            )}
                            {tb === 'export'
                                ? t(
                                      'dataExchange.exportTab',
                                      'Export / Template'
                                  )
                                : t('dataExchange.importTab', 'Import')}
                        </button>
                    ))}
                </div>

                <div className="p-6 space-y-6">
                    {/* Shared: format + scope pickers */}
                    <div className="flex flex-wrap gap-4">
                        <div>
                            <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                                {t('dataExchange.format', 'Format')}
                            </label>
                            <div className="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                                {(['xlsx', 'csv'] as ExchangeFormat[]).map(
                                    (f) => (
                                        <button
                                            key={f}
                                            onClick={() => setFormat(f)}
                                            className={`px-4 py-1.5 text-sm ${
                                                format === f
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                                            }`}
                                        >
                                            {f.toUpperCase()}
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                            {format === 'csv'
                                ? t('dataExchange.entity', 'Entity')
                                : t('dataExchange.entities', 'Entities')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {resources.map((r) => (
                                <button
                                    key={r.key}
                                    data-testid={`scope-${r.key}`}
                                    onClick={() => toggleScope(r.key)}
                                    className={`px-3 py-1 rounded-full text-sm border ${
                                        selected.includes(r.key)
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                                    }`}
                                >
                                    {r.sheet}
                                </button>
                            ))}
                        </div>
                    </div>

                    {tab === 'export' && (
                        <div className="flex flex-wrap gap-3 pt-2">
                            <button
                                data-testid="download-template"
                                disabled={busy || !selected.length}
                                onClick={() =>
                                    run(
                                        () =>
                                            dataExchangeService.downloadTemplate(
                                                format,
                                                scopeForRequest,
                                                false
                                            ),
                                        t(
                                            'dataExchange.templateReady',
                                            'Template downloaded'
                                        )
                                    )
                                }
                                className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm font-medium disabled:opacity-50"
                            >
                                {t(
                                    'dataExchange.emptyTemplate',
                                    'Download empty template'
                                )}
                            </button>
                            <button
                                data-testid="export-data"
                                disabled={busy || !selected.length}
                                onClick={() =>
                                    run(
                                        () =>
                                            dataExchangeService.downloadExport(
                                                format,
                                                scopeForRequest
                                            ),
                                        t(
                                            'dataExchange.exportReady',
                                            'Export downloaded'
                                        )
                                    )
                                }
                                className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                            >
                                {t('dataExchange.exportData', 'Export my data')}
                            </button>
                        </div>
                    )}

                    {tab === 'import' && (
                        <div className="space-y-4">
                            <input
                                ref={fileInputRef}
                                data-testid="import-file-input"
                                type="file"
                                accept=".xlsx,.csv"
                                className="hidden"
                                onChange={(e) =>
                                    handleFile(e.target.files?.[0] ?? null)
                                }
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-8 text-center text-sm text-gray-500 hover:border-blue-400"
                            >
                                {file
                                    ? file.name
                                    : t(
                                          'dataExchange.pickFile',
                                          'Choose an .xlsx or .csv file'
                                      )}
                            </button>

                            <div className="flex flex-wrap items-center gap-4">
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        checked={mode === 'merge'}
                                        onChange={() => setMode('merge')}
                                    />
                                    {t(
                                        'dataExchange.merge',
                                        'Merge (create & update only)'
                                    )}
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        checked={mode === 'sync'}
                                        onChange={() => setMode('sync')}
                                    />
                                    {t(
                                        'dataExchange.sync',
                                        'Sync (also remove missing rows)'
                                    )}
                                </label>
                            </div>

                            {mode === 'sync' && (
                                <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                                    <p className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                        <ExclamationTriangleIcon className="h-4 w-4" />
                                        {t(
                                            'dataExchange.syncWarn',
                                            'Rows missing from the sheet will be archived or deleted for the entities you tick below.'
                                        )}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {selected.map((key) => (
                                            <label
                                                key={key}
                                                className="flex items-center gap-1 text-xs"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={syncScopes.includes(
                                                        key
                                                    )}
                                                    onChange={() =>
                                                        setSyncScopes((prev) =>
                                                            prev.includes(key)
                                                                ? prev.filter(
                                                                      (k) =>
                                                                          k !==
                                                                          key
                                                                  )
                                                                : [...prev, key]
                                                        )
                                                    }
                                                />
                                                {key}
                                            </label>
                                        ))}
                                    </div>
                                    <label className="flex items-center gap-2 text-xs">
                                        {t(
                                            'dataExchange.onRemove',
                                            'On remove:'
                                        )}
                                        <select
                                            value={syncDelete}
                                            onChange={(e) =>
                                                setSyncDelete(
                                                    e.target.value as
                                                        | 'archive'
                                                        | 'destroy'
                                                )
                                            }
                                            className="border rounded px-1 py-0.5 bg-white dark:bg-gray-700"
                                        >
                                            <option value="archive">
                                                {t(
                                                    'dataExchange.archive',
                                                    'archive if possible'
                                                )}
                                            </option>
                                            <option value="destroy">
                                                {t(
                                                    'dataExchange.destroy',
                                                    'delete permanently'
                                                )}
                                            </option>
                                        </select>
                                    </label>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    data-testid="preview-btn"
                                    disabled={busy || !file}
                                    onClick={doPreview}
                                    className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-sm font-medium disabled:opacity-50"
                                >
                                    {t(
                                        'dataExchange.preview',
                                        'Preview changes'
                                    )}
                                </button>
                                <button
                                    data-testid="apply-btn"
                                    disabled={
                                        busy ||
                                        !plan ||
                                        hasErrors ||
                                        plan.committed
                                    }
                                    onClick={doCommit}
                                    className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                                >
                                    {t('dataExchange.apply', 'Apply import')}
                                </button>
                            </div>

                            {plan && <PlanTable plan={plan} />}
                        </div>
                    )}
                </div>
            </div>

            <HistoryPanel jobs={history} />
        </div>
    );
};

const HistoryPanel: React.FC<{ jobs: DataExchangeJob[] }> = ({ jobs }) => {
    const { t } = useTranslation();
    if (!jobs.length) return null;
    return (
        <div
            data-testid="history-panel"
            className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden"
        >
            <div className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700">
                {t('dataExchange.history', 'Recent activity')}
            </div>
            <table className="w-full text-sm">
                <tbody>
                    {jobs.map((job) => (
                        <tr
                            key={job.uid}
                            data-testid="history-row"
                            className="border-t border-gray-100 dark:border-gray-700 first:border-t-0"
                        >
                            <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                                {new Date(job.created_at).toLocaleString()}
                            </td>
                            <td className="px-2 py-2 capitalize">
                                {job.direction}
                            </td>
                            <td className="px-2 py-2 uppercase text-xs text-gray-500">
                                {job.format}
                            </td>
                            <td className="px-2 py-2 text-gray-500">
                                {job.scopes.join(', ')}
                            </td>
                            <td className="px-2 py-2">
                                {job.status === 'error' ? (
                                    <span
                                        className="text-red-600"
                                        title={job.error_message || ''}
                                    >
                                        {t('dataExchange.failed', 'failed')}
                                    </span>
                                ) : job.stats ? (
                                    <span className="text-gray-500">
                                        +{job.stats.created} ~
                                        {job.stats.updated}
                                    </span>
                                ) : (
                                    ''
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const PlanTable: React.FC<{ plan: PlanResult }> = ({ plan }) => {
    const { t } = useTranslation();
    return (
        <div
            data-testid="plan-table"
            className="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
        >
            <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500 bg-gray-50 dark:bg-gray-900/40">
                {plan.committed
                    ? t('dataExchange.result', 'Result')
                    : t('dataExchange.dryRun', 'Dry run — nothing saved yet')}
            </div>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-gray-500">
                        <th className="px-4 py-2">
                            {t('dataExchange.entity', 'Entity')}
                        </th>
                        <th className="px-2 py-2">
                            +{t('dataExchange.new', 'new')}
                        </th>
                        <th className="px-2 py-2">
                            ~{t('dataExchange.upd', 'upd')}
                        </th>
                        <th className="px-2 py-2">
                            ={t('dataExchange.same', 'same')}
                        </th>
                        <th className="px-2 py-2 text-red-600">
                            −{t('dataExchange.del', 'del')}
                        </th>
                        <th className="px-2 py-2 text-red-600">
                            {t('dataExchange.errors', 'errors')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {Object.values(plan.resources).map((r) => (
                        <tr
                            key={r.key}
                            data-testid={`plan-row-${r.key}`}
                            className="border-t border-gray-100 dark:border-gray-700"
                        >
                            <td className="px-4 py-2 font-medium">{r.key}</td>
                            <td className="px-2 py-2" data-testid="plan-created">
                                {r.created}
                            </td>
                            <td className="px-2 py-2" data-testid="plan-updated">
                                {r.updated}
                            </td>
                            <td className="px-2 py-2 text-gray-400">
                                {r.unchanged}
                            </td>
                            <td className="px-2 py-2 text-red-600">
                                {r.pendingDeletes || ''}
                            </td>
                            <td className="px-2 py-2 text-red-600">
                                {r.errors.length || ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {Object.values(plan.resources).some((r) => r.errors.length > 0) && (
                <div className="max-h-48 overflow-y-auto border-t border-gray-200 dark:border-gray-700 p-3 space-y-1 text-xs">
                    {Object.values(plan.resources).flatMap((r) =>
                        r.errors.map((e, i) => (
                            <div key={`${r.key}-${i}`} className="text-red-600">
                                {e.sheet} · row {e.row}
                                {e.column ? ` · ${e.column}` : ''}: {e.message}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default DataExchange;
