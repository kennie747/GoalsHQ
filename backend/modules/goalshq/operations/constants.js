'use strict';

/**
 * Tunable knobs for the GoalsHQ rollup / health model.
 */

// A goal/project is `on_track` while its progress is within this many points of
// the "expected" progress implied by elapsed time; `at_risk` within the next
// band; `off_track` beyond it.
const HEALTH_ON_TRACK_SLACK = 10;
const HEALTH_AT_RISK_SLACK = 25;

const PARENT_TYPES = ['goal', 'strategy', 'project'];
const KEY_RESULT_PARENT_TYPES = ['goal', 'strategy', 'project', 'task'];
const MILESTONE_PARENT_TYPES = ['goal', 'strategy', 'project'];

const STRATEGY_STATUSES = ['active', 'paused', 'achieved', 'dropped'];
const KR_DIRECTIONS = ['increase', 'decrease', 'maintain'];
// 'tasks_done_count' auto-sets current_value to the count of done tasks in the
// KR's parent scope on every rollup pass. Not honored for a task-parented KR.
const KR_AUTO_SOURCES = ['manual', 'tasks_done_count'];
const MILESTONE_STATUSES = ['pending', 'achieved', 'missed'];
const HEALTH_VALUES = ['on_track', 'at_risk', 'off_track', 'no_data'];

module.exports = {
    HEALTH_ON_TRACK_SLACK,
    HEALTH_AT_RISK_SLACK,
    PARENT_TYPES,
    KEY_RESULT_PARENT_TYPES,
    MILESTONE_PARENT_TYPES,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    KR_AUTO_SOURCES,
    MILESTONE_STATUSES,
    HEALTH_VALUES,
};
