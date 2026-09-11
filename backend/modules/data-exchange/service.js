'use strict';

const { RESOURCES, BY_KEY, orderedKeys, ENUMS } = require('./core/registry');
const { buildWorkbook, parseWorkbook } = require('./core/workbook');
const { buildCsv, parseCsv } = require('./core/csv');
const { collectRows } = require('./core/export');
const engine = require('./core/engine');
const jobs = require('./core/jobs');
const { User } = require('../../models');

const ALL_KEYS = RESOURCES.map((r) => r.key);

function badRequest(message) {
    const e = new Error(message);
    e.statusCode = 400;
    return e;
}

function normalizeScopes(scopes, { format }) {
    let keys;
    if (!scopes || scopes === 'all') {
        keys = ALL_KEYS.slice();
    } else {
        keys = (Array.isArray(scopes) ? scopes : String(scopes).split(','))
            .map((s) => s.trim())
            .filter(Boolean);
    }
    const unknown = keys.filter((k) => !BY_KEY[k]);
    if (unknown.length)
        throw badRequest(`Unknown entities: ${unknown.join(', ')}`);
    if (format === 'csv' && keys.length !== 1) {
        throw badRequest(
            'CSV import/export handles exactly one entity at a time'
        );
    }
    return orderedKeys(keys);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

class DataExchangeService {
    describe() {
        return {
            resources: RESOURCES.map((r) => ({
                key: r.key,
                sheet: r.sheet,
                dependsOn: r.dependsOn,
                supportsTags: !!r.tagField,
                columns: r.columns.map((c) => ({
                    header: c.header,
                    kind: c.kind,
                    required: !!c.required,
                    identity: !!c.identity,
                    enumValues: c.enumValues || null,
                    note: c.note || null,
                })),
            })),
            enums: ENUMS,
        };
    }

    async generateTemplate({
        userId,
        format = 'xlsx',
        scopes,
        populate = false,
    }) {
        const keys = normalizeScopes(scopes, { format });
        const data = populate ? await collectRows(userId, keys) : null;
        return this._serialize(
            format,
            keys,
            data,
            populate ? 'export' : 'template'
        );
    }

    async exportData({ userId, format = 'xlsx', scopes }) {
        const keys = normalizeScopes(scopes, { format });
        const data = await collectRows(userId, keys);
        const result = await this._serialize(format, keys, data, 'export');
        await jobs.record({
            userId,
            direction: 'export',
            format,
            scopes: keys,
            filename: result.filename,
        });
        return result;
    }

    _serialize(format, keys, data, kind) {
        if (format === 'csv') {
            const key = keys[0];
            const csv =
                kind === 'template' && !data
                    ? buildCsv(key, [])
                    : buildCsv(key, data[key]);
            return {
                async: false,
                body: Buffer.from(csv, 'utf8'),
                contentType: 'text/csv; charset=utf-8',
                filename: `tududi-${key}-${kind}-${today()}.csv`,
            };
        }
        return buildWorkbook(keys, data).then((buffer) => ({
            body: Buffer.from(buffer),
            contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            filename: `tududi-${kind}-${today()}.xlsx`,
        }));
    }

    async _parseFile({ file, format, keys }) {
        if (!file || !file.buffer) throw badRequest('No file uploaded');
        if (format === 'csv') {
            const { [keys[0]]: rows } = parseCsv(
                keys[0],
                file.buffer.toString('utf8')
            );
            return { [keys[0]]: rows };
        }
        return parseWorkbook(file.buffer, keys);
    }

    async _userTimezone(userId) {
        const user = await User.findByPk(userId, { attributes: ['timezone'] });
        return user?.timezone || 'UTC';
    }

    async preview({ userId, file, format = 'xlsx', scopes, options = {} }) {
        const keys = normalizeScopes(scopes, { format });
        const parsed = await this._parseFile({ file, format, keys });
        const timezone = await this._userTimezone(userId);
        return engine.run({
            userId,
            timezone,
            parsed,
            scopes: keys,
            options: this._coerceOptions(options),
            commit: false,
        });
    }

    async commit({ userId, file, format = 'xlsx', scopes, options = {} }) {
        const keys = normalizeScopes(scopes, { format });
        const coerced = this._coerceOptions(options);
        const parsed = await this._parseFile({ file, format, keys });
        const timezone = await this._userTimezone(userId);

        try {
            const result = await engine.run({
                userId,
                timezone,
                parsed,
                scopes: keys,
                options: coerced,
                commit: true,
            });
            await jobs.record({
                userId,
                direction: 'import',
                format,
                scopes: keys,
                mode: coerced.mode,
                filename: file?.originalname,
                status: 'success',
                stats: result.totals,
            });
            return result;
        } catch (err) {
            await jobs.record({
                userId,
                direction: 'import',
                format,
                scopes: keys,
                mode: coerced.mode,
                filename: file?.originalname,
                status: 'error',
                errorMessage: err.message,
            });
            throw err;
        }
    }

    async listJobs(userId, limit) {
        return jobs.list(userId, limit);
    }

    _coerceOptions(options) {
        const out = {
            mode: options.mode === 'sync' ? 'sync' : 'merge',
            syncDelete:
                options.syncDelete === 'destroy' ? 'destroy' : 'archive',
        };
        if (options.syncScopes) {
            out.syncScopes = Array.isArray(options.syncScopes)
                ? options.syncScopes
                : String(options.syncScopes)
                      .split(',')
                      .map((s) => s.trim());
        }
        if (
            options.confirmDeletes !== undefined &&
            options.confirmDeletes !== null &&
            options.confirmDeletes !== ''
        ) {
            out.confirmDeletes = Number(options.confirmDeletes);
        }
        return out;
    }
}

module.exports = new DataExchangeService();
