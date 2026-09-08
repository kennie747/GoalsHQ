'use strict';

const errors = require('../../shared/errors');
const {
    PARENT_TYPES,
    KEY_RESULT_PARENT_TYPES,
    MILESTONE_PARENT_TYPES,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    KR_AUTO_SOURCES,
    MILESTONE_STATUSES,
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

// A colour is either the empty string ("none") or a #rrggbb / #rgb hex.
function assertColor(value, field = 'color') {
    if (value === undefined || value === null || value === '') return;
    if (
        typeof value !== 'string' ||
        !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ) {
        throw new ValidationError(`${field} must be a hex colour like #2f9e6b`);
    }
}

function assertBoolean(value, field) {
    if (value === undefined) return;
    if (typeof value !== 'boolean') {
        throw new ValidationError(`${field} must be a boolean`);
    }
}

function assertParentType(value, allowed = PARENT_TYPES) {
    if (!allowed.includes(value)) {
        throw new ValidationError(
            `parentType must be one of: ${allowed.join(', ')}`
        );
    }
}

module.exports = {
    requireNonEmptyString,
    assertEnum,
    assertPercent,
    assertNumber,
    assertDate,
    assertColor,
    assertBoolean,
    assertParentType,
    PARENT_TYPES,
    KEY_RESULT_PARENT_TYPES,
    MILESTONE_PARENT_TYPES,
    STRATEGY_STATUSES,
    KR_DIRECTIONS,
    KR_AUTO_SOURCES,
    MILESTONE_STATUSES,
};
