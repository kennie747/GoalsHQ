'use strict';

/**
 * Task status/priority constants and predicates the rollup engine needs,
 * derived directly from the core Task model. Kept in one small file purely to
 * avoid re-deriving the same DONE/EXCLUDED status sets in every consumer —
 * not a merge-isolation boundary (see docs/goalshq/adr/0002-first-class-integration.md).
 */

const { Task } = require('../../../models');

const TASK_STATUS = Task.STATUS;
const TASK_PRIORITY = Task.PRIORITY;

// Statuses that mean "this task is finished for rollup purposes".
const DONE_STATUSES = [TASK_STATUS.DONE];
// Statuses excluded from a rollup denominator entirely (never actionable again).
const EXCLUDED_STATUSES = [TASK_STATUS.ARCHIVED, TASK_STATUS.CANCELLED];

/** A task counts as "done" for progress rollups. */
function isDone(task) {
    return DONE_STATUSES.includes(task.status);
}

/** A task should be excluded from the rollup denominator. */
function isExcluded(task) {
    return EXCLUDED_STATUSES.includes(task.status);
}

module.exports = {
    TASK_STATUS,
    TASK_PRIORITY,
    DONE_STATUSES,
    EXCLUDED_STATUSES,
    isDone,
    isExcluded,
};
