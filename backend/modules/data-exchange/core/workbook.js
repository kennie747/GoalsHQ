'use strict';

const ExcelJS = require('exceljs');
const { RESOURCES, BY_KEY, ENUMS } = require('./registry');

const HEADER_FILL = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };

function enumListFor(column) {
    if (!column.enumValues) return null;
    // exceljs inline list: '"a,b,c"' (max ~255 chars)
    return `"${column.enumValues.join(',')}"`;
}

function addResourceSheet(wb, descriptor, rows) {
    const ws = wb.addWorksheet(descriptor.sheet, {
        views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = descriptor.columns.map((c) => ({
        header: c.header,
        key: c.header,
        width: Math.max(12, Math.min(40, c.header.length + 6)),
    }));

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
    });
    headerRow.commit();

    (rows || []).forEach((row) => {
        const record = {};
        for (const column of descriptor.columns) {
            record[column.header] = column.toCell(row);
        }
        ws.addRow(record);
    });

    // Enum dropdowns on the data range (rows 2..N + buffer for new rows).
    const lastRow = Math.max((rows || []).length + 1, 500);
    descriptor.columns.forEach((column, i) => {
        const list = enumListFor(column);
        if (!list) return;
        const colLetter = ws.getColumn(i + 1).letter;
        for (let r = 2; r <= lastRow; r++) {
            ws.getCell(`${colLetter}${r}`).dataValidation = {
                type: 'list',
                allowBlank: !column.required,
                formulae: [list],
                showErrorMessage: true,
                errorStyle: 'warning',
                error: `Allowed: ${column.enumValues.join(', ')}`,
            };
        }
    });

    // Grey the identity column so users know not to touch it.
    const uidIdx = descriptor.columns.findIndex((c) => c.identity);
    if (uidIdx >= 0) {
        ws.getColumn(uidIdx + 1).font = { color: { argb: 'FF9CA3AF' } };
    }
    return ws;
}

function addReadmeSheet(wb, scopeKeys) {
    const ws = wb.addWorksheet('README', {
        properties: { tabColor: { argb: 'FF2563EB' } },
    });
    ws.getColumn(1).width = 110;
    const lines = [
        'TUDUDI — DATA EXCHANGE WORKBOOK',
        '',
        'HOW IT WORKS',
        '  • One sheet per entity. Fill in rows and upload this file back to Tududi.',
        '  • The "uid" column is the row identity:',
        '      – leave it BLANK to create a new row;',
        '      – keep the existing value to update that row.',
        '  • Parent columns (area / goal / project / parent_task) take the parent' +
            ' NAME. If two parents share a name, use "uid:<uid>" instead.',
        '  • "tags" is comma-separated; unknown tags are created automatically.',
        '  • Dates use ISO format (YYYY-MM-DD or full timestamp).',
        '  • Enum columns (status, priority, horizon, yes/no) have dropdowns.',
        '',
        'IMPORT MODES',
        '  • Merge (default): only creates and updates rows. Nothing is deleted.',
        '  • Sync: for the entities you choose, rows that exist in Tududi but are' +
            ' missing from the sheet are archived (tasks/projects) or deleted' +
            ' (others). You confirm the count after a dry-run preview.',
        '',
        'NOTES',
        '  • Re-uploading an unchanged export makes no changes.',
        '  • Generated recurring task instances are not exported; edit the' +
            ' recurring task itself.',
        '  • Everything is scoped to your account only.',
        '',
        `SHEETS IN THIS FILE: ${scopeKeys.map((k) => BY_KEY[k].sheet).join(', ')}`,
    ];
    lines.forEach((text) => ws.addRow([text]));
    ws.getRow(1).font = { bold: true, size: 14 };
    return ws;
}

function addEnumsSheet(wb) {
    const ws = wb.addWorksheet('Enums');
    ws.addRow(['field', 'allowed values']);
    ws.getRow(1).font = { bold: true };
    Object.entries(ENUMS).forEach(([name, values]) => {
        ws.addRow([name, values.join(', ')]);
    });
    ws.getColumn(1).width = 20;
    ws.getColumn(2).width = 70;
    return ws;
}

/**
 * @param {string[]} scopeKeys
 * @param {object|null} dataByKey  { [key]: serializedRows[] }  (null => empty template)
 */
async function buildWorkbook(scopeKeys, dataByKey) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Tududi';
    wb.created = new Date();

    addReadmeSheet(wb, scopeKeys);
    scopeKeys.forEach((key) => {
        addResourceSheet(wb, BY_KEY[key], dataByKey ? dataByKey[key] : []);
    });
    addEnumsSheet(wb);

    return wb.xlsx.writeBuffer();
}

/**
 * Parse an uploaded workbook into { [key]: [{ rowNum, cells }] } for the
 * requested scopes. Sheets that aren't recognised are ignored.
 */
async function parseWorkbook(buffer, scopeKeys) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const wanted = new Set(
        scopeKeys && scopeKeys.length ? scopeKeys : RESOURCES.map((r) => r.key)
    );
    const bySheetName = {};
    RESOURCES.forEach((r) => {
        bySheetName[r.sheet.toLowerCase()] = r;
    });

    const result = {};
    wb.eachSheet((ws) => {
        const descriptor = bySheetName[ws.name.trim().toLowerCase()];
        if (!descriptor || !wanted.has(descriptor.key)) return;

        const headerCells = ws.getRow(1).values; // 1-indexed array
        const headerIndex = {};
        headerCells.forEach((val, idx) => {
            if (typeof val === 'string') {
                headerIndex[val.trim().toLowerCase()] = idx;
            }
        });

        const rows = [];
        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;
            const cells = {};
            let anyValue = false;
            for (const column of descriptor.columns) {
                const colIdx = headerIndex[column.header.toLowerCase()];
                let value = colIdx ? row.getCell(colIdx).value : undefined;
                if (value && typeof value === 'object') {
                    if (value.text !== undefined)
                        value = value.text; // rich text
                    else if (value.result !== undefined)
                        value = value.result; // formula
                    else if (value.hyperlink !== undefined)
                        value = value.text || value.hyperlink;
                }
                if (
                    value !== null &&
                    value !== undefined &&
                    String(value).trim() !== ''
                ) {
                    anyValue = true;
                }
                cells[column.header] = value;
            }
            if (anyValue) rows.push({ rowNum: rowNumber, cells });
        });

        result[descriptor.key] = rows;
    });

    return result;
}

module.exports = { buildWorkbook, parseWorkbook };
