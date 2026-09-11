import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowUturnRightIcon,
    ExclamationTriangleIcon,
    SparklesIcon,
} from '@heroicons/react/24/outline';
import {
    CarryoverEvent,
    CarryoverClassification,
} from '../../entities/CarryoverEvent';
import {
    fetchCarryoverEvents,
    acceptCarryoverEvent,
    overrideCarryoverEvent,
} from '../../utils/carryoverService';

const CLASSIFICATION_META: Record<
    CarryoverClassification,
    { label: string; icon: React.FC<{ className?: string }>; color: string }
> = {
    resurface: {
        label: 'Resurface',
        icon: SparklesIcon,
        color: 'text-blue-600 dark:text-blue-400',
    },
    reschedule: {
        label: 'Reschedule',
        icon: ArrowUturnRightIcon,
        color: 'text-amber-600 dark:text-amber-400',
    },
    drop: {
        label: 'Drop',
        icon: ExclamationTriangleIcon,
        color: 'text-gray-500 dark:text-gray-400',
    },
};

const CLASSIFICATIONS: CarryoverClassification[] = [
    'resurface',
    'reschedule',
    'drop',
];

interface RowProps {
    event: CarryoverEvent;
    onResolved: (id: number) => void;
}

const CarryoverRow: React.FC<RowProps> = ({ event, onResolved }) => {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [overriding, setOverriding] = useState(false);
    const [classification, setClassification] =
        useState<CarryoverClassification>(event.classification);
    const [newDueDate, setNewDueDate] = useState(
        event.new_due_date || new Date().toISOString().slice(0, 10)
    );

    const meta = CLASSIFICATION_META[event.classification];
    const Icon = meta.icon;

    const handleAccept = async () => {
        setBusy(true);
        try {
            await acceptCarryoverEvent(event.id);
            onResolved(event.id);
        } finally {
            setBusy(false);
        }
    };

    const handleOverrideSubmit = async () => {
        setBusy(true);
        try {
            await overrideCarryoverEvent(event.id, {
                classification,
                new_due_date:
                    classification === 'reschedule' ? newDueDate : null,
            });
            onResolved(event.id);
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="flex flex-col gap-2 rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
            <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 flex-shrink-0 ${meta.color}`} />
                <span className="flex-1 font-medium text-gray-800 dark:text-gray-100">
                    {event.task_name}
                </span>
                <span className={`text-xs font-semibold ${meta.color}`}>
                    {t(`carryover.${event.classification}`, meta.label)}
                </span>
            </div>

            {event.classification === 'reschedule' && event.new_due_date && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t('carryover.proposedDate', 'Proposed new due date')}:{' '}
                    {event.new_due_date}
                </p>
            )}
            {event.classification === 'drop' && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t(
                        'carryover.dropExplanation',
                        'No project/goal, overdue a while, low priority — safe to cancel?'
                    )}
                </p>
            )}
            {event.classification === 'resurface' && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t(
                        'carryover.resurfaceExplanation',
                        'This matters — surfacing it, not touching its due date.'
                    )}
                </p>
            )}

            {overriding ? (
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={classification}
                        onChange={(e) =>
                            setClassification(
                                e.target.value as CarryoverClassification
                            )
                        }
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {CLASSIFICATIONS.map((c) => (
                            <option key={c} value={c}>
                                {t(
                                    `carryover.${c}`,
                                    CLASSIFICATION_META[c].label
                                )}
                            </option>
                        ))}
                    </select>
                    {classification === 'reschedule' && (
                        <input
                            type="date"
                            value={newDueDate}
                            onChange={(e) => setNewDueDate(e.target.value)}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        />
                    )}
                    <button
                        disabled={busy}
                        onClick={handleOverrideSubmit}
                        className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.apply', 'Apply')}
                    </button>
                    <button
                        disabled={busy}
                        onClick={() => setOverriding(false)}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                        {t('common.cancel', 'Cancel')}
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-3">
                    <button
                        disabled={busy}
                        onClick={handleAccept}
                        className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {t('common.accept', 'Accept')}
                    </button>
                    <button
                        disabled={busy}
                        onClick={() => setOverriding(true)}
                        className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        {t('carryover.changeInstead', 'Change instead')}
                    </button>
                </div>
            )}
        </li>
    );
};

/**
 * Carryover review queue (Phase D) — yesterday's-and-earlier unfinished work,
 * classified into resurface/reschedule/drop. Nothing here is ever applied to
 * a task without an explicit Accept/Apply click — see
 * backend/modules/tasks/carryover/service.js.
 */
const CarryoverReview: React.FC = () => {
    const { t } = useTranslation();
    const [events, setEvents] = useState<CarryoverEvent[]>([]);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        try {
            setEvents(await fetchCarryoverEvents());
        } catch {
            // fail silently — this is a supplementary panel, not core Today functionality
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleResolved = (id: number) => {
        setEvents((prev) => prev.filter((e) => e.id !== id));
    };

    if (!loaded || events.length === 0) return null;

    return (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {t('carryover.title', "Carried over from before")} (
                {events.length})
            </h3>
            <ul className="space-y-2">
                {events.map((event) => (
                    <CarryoverRow
                        key={event.id}
                        event={event}
                        onResolved={handleResolved}
                    />
                ))}
            </ul>
        </div>
    );
};

export default CarryoverReview;
