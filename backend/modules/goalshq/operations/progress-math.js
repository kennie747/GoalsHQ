'use strict';

/**
 * Pure progress/health math for GoalsHQ rollups. No DB, no I/O — unit-tested
 * exhaustively in backend/tests/unit/goalshq/progress-math.test.js.
 *
 * All percentages are on a 0–100 scale. Functions return `null` to mean
 * "no data to compute from" (the caller maps that to health `no_data`).
 */

const { HEALTH_ON_TRACK_SLACK, HEALTH_AT_RISK_SLACK } = require('./constants');

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n, lo = 0, hi = 100) {
    if (Number.isNaN(n) || !Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
}

function round1(n) {
    return Math.round(n * 10) / 10;
}

/**
 * Progress of a single key result, 0–100, honouring its direction.
 *  - increase: fraction of the baseline→target gap that has been closed upward
 *  - decrease: fraction closed downward
 *  - maintain: 100 while current is at/above target, else proportional
 */
function keyResultPercent(kr) {
    const baseline = Number(kr.baseline_value ?? 0);
    const target = Number(kr.target_value);
    const current = Number(kr.current_value ?? 0);

    if (!Number.isFinite(target)) return null;

    if (kr.direction === 'maintain') {
        if (!Number.isFinite(current)) return 0;
        if (target === 0) return current >= 0 ? 100 : 0;
        return clamp((current / target) * 100);
    }

    const span = target - baseline;
    if (span === 0) {
        // No gap defined: done iff we've reached the target in the right direction.
        if (kr.direction === 'decrease') return current <= target ? 100 : 0;
        return current >= target ? 100 : 0;
    }
    return clamp(((current - baseline) / span) * 100);
}

/** Mean of the per-KR percentages; null when there are no key results. */
function aggregateKeyResults(keyResults) {
    if (!keyResults || keyResults.length === 0) return null;
    const percents = keyResults.map(keyResultPercent).filter((p) => p !== null);
    if (percents.length === 0) return null;
    return round1(percents.reduce((a, b) => a + b, 0) / percents.length);
}

/** achieved / total milestones as a percentage; null when there are none. */
function milestonePercent(milestones) {
    if (!milestones || milestones.length === 0) return null;
    const achieved = milestones.filter((m) => m.status === 'achieved').length;
    return round1((achieved / milestones.length) * 100);
}

/**
 * Percentage from a task bucket.
 * @param {{doneWeight:number,totalWeight:number}} bucket
 * @returns {number|null} null when the bucket has no countable tasks
 */
function taskBucketPercent(bucket) {
    if (!bucket || bucket.totalWeight <= 0) return null;
    return round1(clamp((bucket.doneWeight / bucket.totalWeight) * 100));
}

/**
 * Weighted average of {value, weight} items. Items with a null value are
 * skipped. Returns null when nothing contributes weight.
 */
function weightedAverage(items) {
    let sum = 0;
    let weight = 0;
    for (const item of items || []) {
        if (item == null || item.value == null) continue;
        const w = item.weight == null ? 1 : item.weight;
        if (w <= 0) continue;
        sum += item.value * w;
        weight += w;
    }
    if (weight <= 0) return null;
    return round1(sum / weight);
}

function toTime(dateish) {
    if (!dateish) return null;
    const t = new Date(dateish).getTime();
    return Number.isNaN(t) ? null : t;
}

/**
 * Fraction of the start→target window that has elapsed as of `today`, on a
 * 0–100 scale. null when the window is undefined or degenerate.
 */
function expectedPercent(startDate, targetDate, today) {
    const start = toTime(startDate);
    const target = toTime(targetDate);
    const now = toTime(today) ?? Date.now();
    if (start == null || target == null) return null;
    if (target <= start) return now >= target ? 100 : 0;
    return clamp(((now - start) / (target - start)) * 100);
}

/**
 * Health verdict comparing actual progress to time elapsed.
 * @returns {'on_track'|'at_risk'|'off_track'|'no_data'}
 */
function health(percent, startDate, targetDate, today, opts = {}) {
    if (percent == null || !targetDate) return 'no_data';
    const expected = expectedPercent(startDate, targetDate, today);
    if (expected == null) return 'no_data';

    const onSlack = opts.onSlack ?? HEALTH_ON_TRACK_SLACK;
    const atSlack = opts.atSlack ?? HEALTH_AT_RISK_SLACK;

    if (percent >= expected - onSlack) return 'on_track';
    if (percent >= expected - atSlack) return 'at_risk';
    return 'off_track';
}

module.exports = {
    DAY_MS,
    clamp,
    round1,
    keyResultPercent,
    aggregateKeyResults,
    milestonePercent,
    taskBucketPercent,
    weightedAverage,
    expectedPercent,
    health,
};
