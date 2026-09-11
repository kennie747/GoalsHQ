'use strict';

/**
 * Cell <-> DB value transforms shared by every resource descriptor.
 * Each helper is intentionally tolerant on input (spreadsheets are messy)
 * and strict on output.
 */

function isBlank(value) {
    return (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')
    );
}

function toStringCell(value) {
    if (isBlank(value)) return '';
    return String(value);
}

function fromStringCell(value) {
    if (isBlank(value)) return null;
    return String(value).trim();
}

function fromTextCell(value) {
    if (isBlank(value)) return null;
    // Preserve internal newlines / spacing for TEXT columns.
    return String(value).replace(/\r\n/g, '\n');
}

function toBoolCell(value) {
    if (value === true) return 'yes';
    if (value === false || value === null || value === undefined) return 'no';
    return value ? 'yes' : 'no';
}

function fromBoolCell(value) {
    if (isBlank(value)) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['yes', 'true', '1', 'y', 'x'].includes(normalized)) return true;
    if (['no', 'false', '0', 'n', ''].includes(normalized)) return false;
    throw new Error(`expected yes/no, got "${value}"`);
}

function toIntCell(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

function fromIntCell(value) {
    if (isBlank(value)) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`expected a whole number, got "${value}"`);
    }
    return n;
}

function toFloatCell(value) {
    if (value === null || value === undefined) return '';
    return String(value);
}

function fromFloatCell(value) {
    if (isBlank(value)) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`expected a number, got "${value}"`);
    }
    return n;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function toDateOnlyCell(value) {
    if (isBlank(value)) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fromDateOnlyCell(value) {
    if (isBlank(value)) return null;
    if (value instanceof Date) return toDateOnlyCell(value);
    const raw = String(value).trim();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        throw new Error(`expected a date (YYYY-MM-DD), got "${value}"`);
    }
    // If the user typed a bare date, keep it verbatim.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return toDateOnlyCell(d);
}

function toDateTimeCell(value) {
    if (isBlank(value)) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString();
}

function fromDateTimeCell(value) {
    if (isBlank(value)) return null;
    const d = value instanceof Date ? value : new Date(String(value).trim());
    if (Number.isNaN(d.getTime())) {
        throw new Error(`expected a date/time, got "${value}"`);
    }
    return d.toISOString();
}

function toListCell(values) {
    if (!Array.isArray(values) || values.length === 0) return '';
    return values.join(', ');
}

function fromListCell(value) {
    if (isBlank(value)) return [];
    return String(value)
        .split(/[,;\n]/)
        .map((v) => v.trim())
        .filter(Boolean);
}

/**
 * Compare a proposed DB value against the current one, tolerating the
 * type drift that survives a spreadsheet round-trip (e.g. "" vs null,
 * Date vs ISO string).
 */
function valuesEqual(current, next) {
    if (current === next) return true;
    if (isBlank(current) && isBlank(next)) return true;
    if (current instanceof Date || next instanceof Date) {
        const a = current ? new Date(current).getTime() : null;
        const b = next ? new Date(next).getTime() : null;
        return a === b;
    }
    // eslint-disable-next-line eqeqeq
    return String(current ?? '') == String(next ?? '');
}

module.exports = {
    isBlank,
    toStringCell,
    fromStringCell,
    fromTextCell,
    toBoolCell,
    fromBoolCell,
    toIntCell,
    fromIntCell,
    toFloatCell,
    fromFloatCell,
    toDateOnlyCell,
    fromDateOnlyCell,
    toDateTimeCell,
    fromDateTimeCell,
    toListCell,
    fromListCell,
    valuesEqual,
};
