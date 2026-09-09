import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    fetchGoalshqProject,
    updateGoalshqProjectSettings,
} from '../../utils/goalsHqService';
import { DualProgress } from '../Shared/ProgressIndicators';
import MetricsPanels from '../Strategy/MetricsPanels';
import RecordsPanel from '../Strategy/RecordsPanel';
import ReportTab from '../Strategy/ReportTab';

interface Props {
    projectUid: string;
}

type Tab = 'progress' | 'records' | 'report';

/**
 * GoalsHQ measurement surface for a single project: execution (always on) +
 * optional outcome metrics (Key Results / Milestones / Records / Report).
 * Mirrors the block on the Goal detail page.
 */
const ProjectGoalsHqPanel: React.FC<Props> = ({ projectUid }) => {
    const { t } = useTranslation();
    const [hq, setHq] = useState<any | null>(null);
    const [error, setError] = useState(false);
    const [tab, setTab] = useState<Tab>('progress');

    const load = useCallback(async () => {
        try {
            setHq(await fetchGoalshqProject(projectUid));
            setError(false);
        } catch {
            setError(true);
        }
    }, [projectUid]);

    useEffect(() => {
        load();
    }, [load]);

    const toggleOutcome = async (enabled: boolean) => {
        await updateGoalshqProjectSettings(projectUid, {
            metrics_enabled: enabled,
        });
        load();
    };

    if (error) {
        return (
            <p className="p-4 text-sm text-gray-400">
                {t('goalshq.metricsUnavailable', 'Metrics are unavailable.')}
            </p>
        );
    }
    if (!hq) {
        return (
            <p className="p-4 text-sm text-gray-400">
                {t('common.loading', 'Loading...')}
            </p>
        );
    }

    const metricsEnabled = hq.settings?.metrics_enabled;

    return (
        <div>
            <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
                {(['progress', 'records', 'report'] as const).map((x) => (
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
                    parentType="project"
                    parentUid={projectUid}
                    keyResults={hq.key_results || []}
                />
            )}
            {tab === 'report' && (
                <ReportTab parentType="project" parentUid={projectUid} />
            )}
            {tab === 'progress' && (
                <>
                    <DualProgress
                        executionPercent={hq.execution_percent}
                        executionHealth={hq.execution_health}
                        outcomePercent={hq.outcome_percent}
                        outcomeHealth={hq.outcome_health}
                        metricsEnabled={metricsEnabled}
                        executionNote={t(
                            'goalshq.fromTasks',
                            'from task completion'
                        )}
                        outcomeNote={t(
                            'goalshq.fromKrs',
                            'from {{n}} key results',
                            { n: (hq.key_results || []).length }
                        )}
                        executionTrend={(hq.trend || []).filter(
                            (s: any) => (s.kind ?? 'execution') === 'execution'
                        )}
                        outcomeTrend={(hq.trend || []).filter(
                            (s: any) => s.kind === 'outcome'
                        )}
                    />

                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked={!!metricsEnabled}
                            onChange={(e) => toggleOutcome(e.target.checked)}
                        />
                        {t(
                            'goalshq.enableOutcomeMetrics',
                            'Track outcome metrics (Key Results / Milestones)'
                        )}
                    </label>

                    {metricsEnabled && (
                        <section className="mt-6">
                            <MetricsPanels
                                parentType="project"
                                parentUid={projectUid}
                                keyResults={hq.key_results || []}
                                milestones={hq.milestones || []}
                                onChange={load}
                            />
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default ProjectGoalsHqPanel;
