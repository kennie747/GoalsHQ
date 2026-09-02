'use strict';

const { errors } = require('./core/tududi');
const {
    GOAL_PROGRESS_MODES,
    STRATEGY_PROGRESS_MODES,
    STRATEGY_KINDS,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    MILESTONE_STATUSES,
    MIN_IMPORTANCE,
    MAX_IMPORTANCE,
} = require('./operations/constants');

const { ValidationError } = errors;

function requireNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ValidationError(`${field} is required`);
    }
    return value.trim();
}

function assertEnum(value, allowed, field) {
    if (value === undefined) return;
    if (!allowed.includes(value)) {
        throw new ValidationError(
            `${field} must be one of: ${allowed.join(', ')}`
        );
    }
}

function assertImportance(value) {
    if (value === undefined) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN_IMPORTANCE || n > MAX_IMPORTANCE) {
        throw new ValidationError(
            `importance must be an integer between ${MIN_IMPORTANCE} and ${MAX_IMPORTANCE}`
        );
    }
}

function assertPercent(value, field) {
    if (value === undefined || value === null) return;
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n > 100) {
        throw new ValidationError(`${field} must be between 0 and 100`);
    }
}

function assertNumber(value, field) {
    if (value === undefined || value === null) return;
    if (Number.isNaN(Number(value))) {
        throw new ValidationError(`${field} must be a number`);
    }
}

function assertDate(value, field) {
    if (value === undefined || value === null || value === '') return;
    if (Number.isNaN(new Date(value).getTime())) {
        throw new ValidationError(`${field} must be a valid date`);
    }
}

function assertParentType(value) {
    if (!['goal', 'strategy'].includes(value)) {
        throw new ValidationError('parentType must be "goal" or "strategy"');
    }
}

module.exports = {
    requireNonEmptyString,
    assertEnum,
    assertImportance,
    assertPercent,
    assertNumber,
    assertDate,
    assertParentType,
    GOAL_PROGRESS_MODES,
    STRATEGY_PROGRESS_MODES,
    STRATEGY_KINDS,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    MILESTONE_STATUSES,
};
