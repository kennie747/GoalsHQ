import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArchiveBoxIcon, FlagIcon } from '@heroicons/react/24/outline';
import { fetchCarryoverHistory } from '../../utils/carryoverService';
import { fetchGoalshqGoals } from '../../utils/goalsHqService';
import { CarryoverEvent } from '../../entities/CarryoverEvent';
import { GoalSummary } from '../../entities/Goal';
import { createGoalUrl } from '../../utils/slugUtils';
import { HealthChip, ProgressBar, PercentLabel } from '../Shared/ProgressIndicators';

const CLASSIFICATION_LABEL: Record<CarryoverEvent['classification'], string> = {
    resurface: 'Resurface',
    reschedule: 'Reschedule',
    drop: 'Drop',
};

/**
 * Phase F — read-only archive: every past carryover decision (reviewed or
 * not) plus a snapshot of every goal's current progress/health, both of
 * which otherwise have no dedicated home once a carryover event leaves the
 * Today worksheet's pending queue or a goal's trend scrolls past what its
 * own detail page shows inline.
 */
const ArchivePage: React.FC = () => {
    const { t } = useTranslation();
    const [events, setEvents] = useState<CarryoverEvent[] | null>(null);
    const [eventsError, setEventsError] = useState(false);
    const [goals, setGoals] = useState<GoalSummary[] | null>(null);
    const [goalsError, setGoalsError] = useState(false);

    useEffect(() => {
        fetchCarryoverHistory()
            .then(setEvents)
            .catch(() => setEventsError(true));
        fetchGoalshqGoals()
            .then(setGoals)
            .catch(() => setGoalsError(true));
    }, []);

    return (
        <div className="mx-auto max-w-5xl px-4 py-6">
            <div className="mb-6 flex items-center gap-2">
                <ArchiveBoxIcon className="h-6 w-6 text-gray-400" />
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {t('archive.title', 'Archive')}
                </h1>
            </div>

            <section className="mb-10">
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('archive.carryoverHistory', 'Carryover history')}
                </h2>
                {eventsError && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {t(
                            'archive.carryoverLoadError',
                            'Could not load carryover history.'
                        )}
                    </p>
                )}
                {!eventsError && events === null && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('common.loading', 'Loading...')}
                    </p>
                )}
                {events !== null && events.length === 0 && (
                    <p className="text-sm text-gray-400">
                        {t(
                            'archive.noCarryoverHistory',
                            'No carryover events yet.'
                        )}
                    </p>
                )}
                {events !== null && events.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                <tr>
                                    <th className="px-3 py-2">
                                        {t('archive.colTask', 'Task')}
                                    </th>
                                    <th className="px-3 py-2">
                                        {t('archive.colClassification', 'Decision')}
                                    </th>
                                    <th className="px-3 py-2">
                                        {t('archive.colOccurredOn', 'Occurred')}
                                    </th>
                                    <th className="px-3 py-2">
                                        {t('archive.colSource', 'Source')}
                                    </th>
                                    <th className="px-3 py-2">
                                        {t('archive.colReviewed', 'Reviewed')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((e) => (
                                    <tr
                                        key={e.id}
                                        className="border-t border-gray-100 dark:border-gray-800"
                                    >
                                        <td className="px-3 py-2 text-gray-800 dark:text-gray-100">
                                            {e.task_name ?? (
                                                <span className="italic text-gray-400">
                                                    {t(
                                                        'archive.taskDeleted',
                                                        'deleted task'
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                                            {t(
                                                `carryover.${e.classification}`,
                                                CLASSIFICATION_LABEL[
                                                    e.classification
                                                ]
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                            {e.occurred_on}
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                            {e.source === 'user_override'
                                                ? t(
                                                      'archive.sourceOverride',
                                                      'you'
                                                  )
                                                : t('archive.sourceAuto', 'auto')}
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                            {e.reviewed_at
                                                ? t('archive.reviewed', 'yes')
                                                : t('archive.pending', 'pending')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
                    {t('archive.goalProgress', 'Goal progress')}
                </h2>
                {goalsError && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {t(
                            'archive.goalsLoadError',
                            'Could not load goal progress.'
                        )}
                    </p>
                )}
                {!goalsError && goals === null && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('common.loading', 'Loading...')}
                    </p>
                )}
                {goals !== null && goals.length === 0 && (
                    <p className="text-sm text-gray-400">
                        {t('archive.noGoals', 'No goals yet.')}
                    </p>
                )}
                {goals !== null && goals.length > 0 && (
                    <ul className="space-y-2">
                        {goals.map((g) => (
                            <li key={g.uid}>
                                <Link
                                    to={createGoalUrl({
                                        uid: g.uid,
                                        title: g.title,
                                    })}
                                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:shadow-sm dark:border-gray-700"
                                >
                                    <FlagIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                                    <span className="flex-1 font-medium text-gray-800 dark:text-gray-100">
                                        {g.title}
                                    </span>
                                    <ProgressBar
                                        percent={g.percent}
                                        health={g.health}
                                        className="w-24"
                                    />
                                    <PercentLabel percent={g.percent} />
                                    <HealthChip health={g.health} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-3 text-xs text-gray-400">
                    {t(
                        'archive.goalProgressHint',
                        "Open a goal for its full progress trend over time."
                    )}
                </p>
            </section>
        </div>
    );
};

export default ArchivePage;
