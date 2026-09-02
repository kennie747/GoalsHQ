'use strict';

/**
 * Tunable knobs for the GoalsHQ rollup / health model. Kept in one place so the
 * design step (and later the user) can adjust cadence assumptions without
 * hunting through the engine.
 */

// A goal/strategy is `on_track` while its progress is within this many points of
// the "expected" progress implied by elapsed time; `at_risk` within the next
// band; `off_track` beyond it.
const HEALTH_ON_TRACK_SLACK = 10;
const HEALTH_AT_RISK_SLACK = 25;

const GOAL_PROGRESS_MODES = [
    'rollup_strategies',
    'rollup_projects',
    'rollup_tasks',
    'metric',
    'milestones',
    'manual',
];

const STRATEGY_PROGRESS_MODES = [
    'rollup_projects',
    'rollup_tasks',
    'metric',
    'milestones',
    'manual',
];

const STRATEGY_KINDS = ['primary', 'secondary', 'experiment'];
const STRATEGY_STATUSES = ['active', 'paused', 'achieved', 'dropped'];
const KR_DIRECTIONS = ['increase', 'decrease', 'maintain'];
const MILESTONE_STATUSES = ['pending', 'achieved', 'missed'];
const HEALTH_VALUES = ['on_track', 'at_risk', 'off_track', 'no_data'];

const DEFAULT_IMPORTANCE = 3;
const MIN_IMPORTANCE = 1;
const MAX_IMPORTANCE = 5;

module.exports = {
    HEALTH_ON_TRACK_SLACK,
    HEALTH_AT_RISK_SLACK,
    GOAL_PROGRESS_MODES,
    STRATEGY_PROGRESS_MODES,
    STRATEGY_KINDS,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    MILESTONE_STATUSES,
    HEALTH_VALUES,
    DEFAULT_IMPORTANCE,
    MIN_IMPORTANCE,
    MAX_IMPORTANCE,
};
