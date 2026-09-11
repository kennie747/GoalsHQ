import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PrinterIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { GoalshqReport } from '../../entities/GoalshqReport';
import { fetchGoalshqReport } from '../../utils/goalsHqService';
import {
    ProgressBar,
    HealthChip,
    PercentLabel,
} from '../Shared/ProgressIndicators';

interface Props {
    parentType: 'goal' | 'strategy' | 'project';
    parentUid: string;
}

const Bars: React.FC<{
    rows: { key: string; count: number; sum: number }[];
}> = ({ rows }) => {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <div className="space-y-1 text-xs">
            {rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                    <span className="w-24 truncate text-gray-500">{r.key}</span>
                    <span
                        className="h-2 rounded bg-blue-400"
                        style={{ width: `${(r.count / max) * 100}px` }}
                    />
                    <span className="text-gray-400">{r.count}</span>
                </div>
            ))}
        </div>
    );
};

const ReportTab: React.FC<Props> = ({ parentType, parentUid }) => {
    const { t } = useTranslation();
    const [period, setPeriod] = useState('30d');
    const [report, setReport] = useState<GoalshqReport | null>(null);
    const [showQual, setShowQual] = useState(false);

    const load = useCallback(async () => {
        try {
            setReport(await fetchGoalshqReport(parentType, parentUid, period));
        } catch {
            setReport(null);
        }
    }, [parentType, parentUid, period]);

    useEffect(() => {
        load();
    }, [load]);

    if (!report) {
        return (
            <p className="p-4 text-sm text-gray-400">
                {t('common.loading', 'Loading...')}
            </p>
        );
    }
    const q = report.quantitative;

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('goalshq.report', 'Report')} · {report.title}
                </h3>
                <div className="flex items-center gap-2">
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                    >
                        <option value="30d">
                            {t('goalshq.last30', 'Last 30 days')}
                        </option>
                        <option value="quarter">
                            {t('goalshq.thisQuarter', 'This quarter')}
                        </option>
                        <option value="all">
                            {t('goalshq.allTime', 'All time')}
                        </option>
                    </select>
                    <button
                        onClick={() => window.print()}
                        className="rounded border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 dark:border-gray-600"
                        title={t('common.print', 'Print')}
                    >
                        <PrinterIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Quantitative */}
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('goalshq.quantitative', 'Quantitative')}
                </div>
                <div className="mb-2 flex items-center gap-2">
                    <span className="w-20 text-xs text-gray-500">
                        {t('goalshq.execution', 'Execution')}
                    </span>
                    <ProgressBar
                        percent={q.execution_percent}
                        health={q.execution_health}
                        className="max-w-xs"
                    />
                    <PercentLabel percent={q.execution_percent} />
                    <HealthChip health={q.execution_health} />
                </div>
                {q.outcome_percent != null && (
                    <div className="mb-2 flex items-center gap-2">
                        <span className="w-20 text-xs text-gray-500">
                            {t('goalshq.outcome', 'Outcome')}
                        </span>
                        <ProgressBar
                            percent={q.outcome_percent}
                            health={q.outcome_health}
                            className="max-w-xs"
                        />
                        <PercentLabel percent={q.outcome_percent} />
                        <HealthChip health={q.outcome_health} />
                    </div>
                )}
                {q.key_results.length > 0 && (
                    <table className="mt-3 w-full text-sm">
                        <tbody>
                            {q.key_results.map((k) => (
                                <tr key={k.name}>
                                    <td className="py-1 pr-2 text-gray-700 dark:text-gray-200">
                                        {k.name}
                                    </td>
                                    <td className="py-1 pr-2 text-gray-400">
                                        {k.current_value} / {k.target_value}
                                        {k.unit ? ` ${k.unit}` : ''}
                                    </td>
                                    <td className="w-32 py-1">
                                        <ProgressBar percent={k.percent} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {q.by_category.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-gray-400">
                                {t('goalshq.byCategory', 'By category')}
                            </div>
                            <Bars rows={q.by_category} />
                        </div>
                    )}
                    {q.milestones.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs text-gray-400">
                                {t('goalshq.milestones', 'Milestones')}
                            </div>
                            <div className="text-xs">
                                {
                                    q.milestones.filter(
                                        (m) => m.status === 'achieved'
                                    ).length
                                }{' '}
                                / {q.milestones.length}{' '}
                                {t('goalshq.achieved', 'achieved')}
                            </div>
                        </div>
                    )}
                </div>
                <div className="mt-2 text-xs text-gray-400">
                    {q.record_count} {t('goalshq.recordsLogged', 'records')}
                </div>
            </div>

            {/* Qualitative — narrative fetched-on-open (already in payload) */}
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <button
                    onClick={() => setShowQual((v) => !v)}
                    className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400"
                >
                    {t('goalshq.qualitative', 'Qualitative')}
                    <span>{showQual ? '▾' : '▸'}</span>
                </button>
                {showQual && (
                    <div className="mt-2">
                        <div className="mb-1 flex items-center gap-1 text-xs text-gray-400">
                            <SparklesIcon className="h-3.5 w-3.5" />
                            {report.qualitative.narrative_source === 'ai'
                                ? t('goalshq.aiNarrative', 'AI narrative')
                                : t('goalshq.summary', 'Summary')}
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-200">
                            {report.qualitative.narrative}
                        </p>
                        {report.qualitative.notes.length > 0 && (
                            <ul className="mt-3 space-y-1 text-xs text-gray-500">
                                {report.qualitative.notes.map((n, i) => (
                                    <li key={i}>
                                        <span className="text-gray-400">
                                            {n.date}
                                        </span>{' '}
                                        {n.title} — {n.body}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportTab;
