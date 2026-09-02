import React from 'react';
import { useTranslation } from 'react-i18next';
import { GoalshqHealth, ProgressSnapshot } from '../../../entities/GoalsHq';

export const HEALTH_STYLES: Record<GoalshqHealth, string> = {
    on_track:
        'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    at_risk:
        'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    off_track: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    no_data: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

const HEALTH_BAR: Record<GoalshqHealth, string> = {
    on_track: 'bg-green-500',
    at_risk: 'bg-amber-500',
    off_track: 'bg-red-500',
    no_data: 'bg-gray-400',
};

export const ProgressBar: React.FC<{
    percent: number | null;
    health?: GoalshqHealth;
    className?: string;
}> = ({ percent, health = 'no_data', className = '' }) => {
    const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
    return (
        <div
            className={`h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className={`h-2 rounded-full ${HEALTH_BAR[health]}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};

export const HealthChip: React.FC<{ health: GoalshqHealth }> = ({ health }) => {
    const { t } = useTranslation();
    const label = t(
        `goalshq.health.${health}`,
        {
            on_track: 'On track',
            at_risk: 'At risk',
            off_track: 'Off track',
            no_data: 'No data',
        }[health] as string
    );
    return (
        <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLES[health]}`}
        >
            {label}
        </span>
    );
};

export const PercentLabel: React.FC<{ percent: number | null }> = ({
    percent,
}) => (
    <span className="tabular-nums text-sm font-semibold text-gray-700 dark:text-gray-200">
        {percent == null ? '—' : `${Math.round(percent)}%`}
    </span>
);

export const ImportanceStars: React.FC<{
    value: number;
    onChange?: (v: number) => void;
}> = ({ value, onChange }) => (
    <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
            <button
                key={n}
                type="button"
                aria-label={`Importance ${n}`}
                disabled={!onChange}
                onClick={() => onChange && onChange(n)}
                className={`text-sm leading-none ${
                    n <= value
                        ? 'text-amber-500'
                        : 'text-gray-300 dark:text-gray-600'
                } ${onChange ? 'cursor-pointer' : 'cursor-default'}`}
            >
                ★
            </button>
        ))}
    </span>
);

export const TrendSparkline: React.FC<{
    points: ProgressSnapshot[];
    width?: number;
    height?: number;
}> = ({ points, width = 160, height = 36 }) => {
    const vals = points
        .map((p) => (p.percent == null ? null : p.percent))
        .filter((v): v is number => v != null);
    if (vals.length < 2) {
        return (
            <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
        );
    }
    const max = 100;
    const stepX = width / (vals.length - 1);
    const d = vals
        .map((v, i) => {
            const x = i * stepX;
            const y = height - (v / max) * height;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="text-blue-500"
            aria-hidden="true"
        >
            <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </svg>
    );
};
