'use strict';

const Papa = require('papaparse');
const { BY_KEY } = require('./registry');

/**
 * CSV is a single-resource format: one file == one entity's sheet.
 */
function buildCsv(key, serializedRows) {
    const descriptor = BY_KEY[key];
    const headers = descriptor.columns.map((c) => c.header);
    const data = (serializedRows || []).map((row) => {
        const record = {};
        for (const column of descriptor.columns) {
            record[column.header] = column.toCell(row);
        }
        return record;
    });
    return Papa.unparse({ fields: headers, data });
}

function parseCsv(key, text) {
    const descriptor = BY_KEY[key];
    const parsed = Papa.parse(text.trim(), {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (h) => h.trim(),
    });
    if (parsed.errors && parsed.errors.length) {
        const first = parsed.errors[0];
        const e = new Error(
            `CSV parse error: ${first.message} (row ${first.row})`
        );
        e.statusCode = 400;
        throw e;
    }

    const knownHeaders = new Set(
        descriptor.columns.map((c) => c.header.toLowerCase())
    );
    const rows = parsed.data.map((record, i) => {
        const cells = {};
        for (const column of descriptor.columns) {
            const match = Object.keys(record).find(
                (k) => k.toLowerCase() === column.header.toLowerCase()
            );
            cells[column.header] = match ? record[match] : undefined;
        }
        // rowNum: +2 => 1 for the header line, 1 for 1-indexing
        return { rowNum: i + 2, cells };
    });

    // Ignore fully-blank rows.
    const nonEmpty = rows.filter((r) =>
        Object.values(r.cells).some(
            (v) => v !== undefined && String(v).trim() !== ''
        )
    );

    return {
        [key]: nonEmpty,
        __unknownHeaders: [...Object.keys(parsed.data[0] || {})].filter(
            (h) => !knownHeaders.has(h.toLowerCase())
        ),
    };
}

module.exports = { buildCsv, parseCsv };
