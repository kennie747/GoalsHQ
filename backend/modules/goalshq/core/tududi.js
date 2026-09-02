'use strict';

/**
 * COMPAT SHIM — the single file in the GoalsHQ backend module that reaches into
 * tududi core. Every other GoalsHQ file imports what it needs from here, so an
 * upstream rename/move is a one-file fix (and `goalshq-contract.test.js` fails
 * loudly if the surface below drifts).
 *
 * See docs/goalshq/adr/0001-isolation-architecture.md.
 */

const { Op, fn, col, literal } = require('sequelize');
const models = require('../../../models');
const { getConfig } = require('../../../config/config');
const logService = require('../../../services/logService');
const errors = require('../../../shared/errors');
const { getAuthenticatedUserId } = require('../../../utils/request-utils');
const timezone = require('../../../utils/timezone-utils');

const { sequelize, Goal, Project, Task, User } = models;

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

/** Resolve a user's IANA timezone string, falling back to UTC. */
function userTimezone(user) {
    return timezone.getSafeTimezone(user && user.timezone);
}

/** Current calendar date (YYYY-MM-DD) in the user's timezone. */
function todayInUserTz(user) {
    return timezone.getCurrentDateInTimezone(userTimezone(user));
}

module.exports = {
    // ORM
    sequelize,
    Op,
    fn,
    col,
    literal,
    Goal,
    Project,
    Task,
    User,

    // Constants
    TASK_STATUS,
    TASK_PRIORITY,
    DONE_STATUSES,
    EXCLUDED_STATUSES,

    // Predicates / helpers
    isDone,
    isExcluded,
    userTimezone,
    todayInUserTz,

    // Cross-cutting infra
    config: getConfig(),
    logService,
    errors,
    getAuthenticatedUserId,
    timezone,
};
