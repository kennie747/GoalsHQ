'use strict';

const { sequelize } = require('../../../models');
const { BY_KEY, orderedKeys, withDependencies } = require('./registry');
const { valuesEqual, isBlank } = require('./columns');
const repository = require('../repository');
const { validateTagName } = require('../../tags/tagsService');

const AMBIGUOUS = Symbol('ambiguous');

/**
 * Shared create/update/sync engine. Runs the exact same logic for the preview
 * (`commit: false`, no writes) and the commit (`commit: true`, one transaction).
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.timezone
 * @param {object} params.parsed         { [resourceKey]: [{ rowNum, cells }] }
 * @param {string[]} params.scopes       resource keys the user is importing
 * @param {object} params.options        { mode, syncScopes, syncDelete, confirmDeletes }
 * @param {boolean} params.commit
 */
async function run({ userId, timezone, parsed, scopes, options, commit }) {
    const mode = options.mode === 'sync' ? 'sync' : 'merge';
    const syncScopes = new Set(mode === 'sync' ? options.syncScopes || [] : []);
    const syncDelete = options.syncDelete === 'destroy' ? 'destroy' : 'archive';

    const keys = orderedKeys(scopes); // resources we create/update/sync
    const indexKeys = withDependencies(keys); // + read-only parents for FK resolution
    const transaction = commit ? await sequelize.transaction() : null;

    try {
        // refMap[key] = { byUid: Map, byName: Map, rowsByUid: Map, rowsByNat: Map }
        const refMap = {};
        for (const key of indexKeys) {
            refMap[key] = await buildIndex(BY_KEY[key], userId, transaction);
        }

        const report = {};
        let hasErrors = false;

        for (const key of keys) {
            const descriptor = BY_KEY[key];
            const rows = parsed[key] || [];
            const resourceReport = {
                key,
                created: 0,
                updated: 0,
                unchanged: 0,
                errors: [],
                deleted: [],
                pendingDeletes: 0,
            };
            report[key] = resourceReport;

            const deferredWork = [];
            const seen = new Set(); // natural keys / uids present in the sheet

            for (const row of rows) {
                const ctx = makeCtx(refMap, resourceReport, descriptor, row);
                let attrs;
                try {
                    attrs = buildAttrs(descriptor, row, ctx, {
                        deferred: false,
                    });
                } catch (err) {
                    // buildAttrs only throws for fatal row problems
                    addError(
                        resourceReport,
                        descriptor,
                        row,
                        null,
                        err.message
                    );
                    continue;
                }
                if (ctx.rowFailed) continue;

                // Resolve identity: existing row (update) vs new row (create).
                const idx = refMap[key];
                const uid = attrs.uid || null;
                let existing = null;
                if (uid && idx.rowsByUid.has(uid)) {
                    existing = idx.rowsByUid.get(uid);
                }
                let natKey = null;
                if (!existing) {
                    natKey = descriptor.naturalKey(attrs);
                    const hit = idx.rowsByNat.get(natKey);
                    if (hit === AMBIGUOUS) {
                        addError(
                            resourceReport,
                            descriptor,
                            row,
                            descriptor.displayKey,
                            `matches more than one existing ${key} — add its uid to disambiguate`
                        );
                        continue;
                    }
                    existing = hit || null;
                }

                const tagNames = descriptor.tagField
                    ? sanitizeTags(
                          row.cells.tags,
                          resourceReport,
                          descriptor,
                          row
                      )
                    : null;

                if (existing) {
                    seen.add(existing.uid);
                    const changes = diffAttrs(descriptor, existing, attrs);
                    const tagChanged =
                        tagNames !== null &&
                        tagsDiffer(existing.Tags || [], tagNames);
                    if (Object.keys(changes).length === 0 && !tagChanged) {
                        resourceReport.unchanged++;
                    } else {
                        resourceReport.updated++;
                        if (commit) {
                            await existing.update(changes, { transaction });
                            if (tagChanged) {
                                await applyTags(
                                    existing,
                                    userId,
                                    tagNames,
                                    transaction
                                );
                            }
                        }
                    }
                    registerRow(idx, descriptor, existing, existing.id);
                    scheduleDeferred(
                        deferredWork,
                        descriptor,
                        row,
                        existing,
                        commit
                    );
                    continue;
                }

                // create
                resourceReport.created++;
                const createData = { ...attrs, user_id: userId };
                delete createData.uid;
                // A supplied uid is honoured (cross-instance transfer) only if it
                // is not already taken by anyone — never let a sheet address
                // another tenant's row. Otherwise a fresh uid is generated.
                if (attrs.uid) {
                    const clash = await descriptor.model.findOne({
                        where: { uid: attrs.uid },
                        transaction,
                    });
                    if (!clash) createData.uid = attrs.uid;
                }

                let created;
                if (commit) {
                    created = await descriptor.model.create(createData, {
                        transaction,
                    });
                    if (tagNames && tagNames.length) {
                        await applyTags(created, userId, tagNames, transaction);
                    }
                } else {
                    // Synthetic stand-in so later resources / self-refs resolve.
                    created = descriptor.model.build({
                        ...createData,
                        id:
                            -1 * (resourceReport.created + 1) -
                            row.rowNum * 1000,
                    });
                }
                if (natKey) seen.add(natKey);
                if (created.uid) seen.add(created.uid);
                registerRow(idx, descriptor, created, created.id);
                scheduleDeferred(
                    deferredWork,
                    descriptor,
                    row,
                    created,
                    commit
                );
            }

            // Deferred pass (self-references such as parent_task).
            for (const work of deferredWork) {
                const ctx = makeCtx(
                    refMap,
                    resourceReport,
                    descriptor,
                    work.row
                );
                let patch;
                try {
                    patch = buildAttrs(descriptor, work.row, ctx, {
                        deferred: true,
                        only: true,
                    });
                } catch (err) {
                    addError(
                        resourceReport,
                        descriptor,
                        work.row,
                        null,
                        err.message
                    );
                    continue;
                }
                if (ctx.rowFailed) continue;
                const realPatch = {};
                for (const [k, v] of Object.entries(patch)) {
                    if (!valuesEqual(work.instance[k], v)) realPatch[k] = v;
                }
                if (Object.keys(realPatch).length && commit) {
                    await work.instance.update(realPatch, { transaction });
                }
            }

            // Sync (delete): compute now, execute after all resources planned.
            if (syncScopes.has(key)) {
                const survivors = new Set(seen);
                for (const dbRow of refMap[key].all) {
                    if (survivors.has(dbRow.uid)) continue;
                    if (survivors.has(descriptor.naturalKey(dbRow))) continue;
                    resourceReport.deleted.push({
                        uid: dbRow.uid,
                        label: dbRow[descriptor.displayKey],
                    });
                }
                resourceReport.pendingDeletes = resourceReport.deleted.length;
            }

            if (resourceReport.errors.length) hasErrors = true;
        }

        const totalPendingDeletes = Object.values(report).reduce(
            (n, r) => n + r.pendingDeletes,
            0
        );

        if (commit && totalPendingDeletes > 0) {
            if (
                typeof options.confirmDeletes === 'number' &&
                options.confirmDeletes !== totalPendingDeletes
            ) {
                const e = new Error(
                    `Delete count changed: preview had ${totalPendingDeletes}, request confirmed ${options.confirmDeletes}. Re-run preview.`
                );
                e.statusCode = 409;
                throw e;
            }
            for (const key of keys) {
                const descriptor = BY_KEY[key];
                for (const victim of report[key].deleted) {
                    const inst = refMap[key].rowsByUid.get(victim.uid);
                    if (!inst) continue;
                    if (
                        syncDelete === 'archive' &&
                        descriptor.model.rawAttributes.status
                    ) {
                        await inst.update(
                            { status: key === 'tasks' ? 3 : 'cancelled' },
                            { transaction }
                        );
                    } else {
                        await inst.destroy({ transaction });
                    }
                }
            }
        }

        if (commit && hasErrors) {
            const e = new Error(
                'Import aborted: the file still contains row errors. Fix them and re-run preview.'
            );
            e.statusCode = 422;
            throw e;
        }

        if (transaction) await transaction.commit();

        return {
            mode,
            committed: !!commit,
            resources: report,
            totals: summarize(report),
        };
    } catch (err) {
        if (transaction) await transaction.rollback();
        throw err;
    }
}

/* ------------------------------------------------------------------ */

async function buildIndex(descriptor, userId, transaction) {
    const all = await repository.loadAll(descriptor, userId, transaction);
    const idx = {
        all,
        byUid: new Map(),
        byName: new Map(),
        rowsByUid: new Map(),
        rowsByNat: new Map(),
    };
    for (const row of all) {
        idx.byUid.set(row.uid, row.id);
        idx.rowsByUid.set(row.uid, row);
        setNat(idx, descriptor.naturalKey(row), row);
        addName(idx, descriptor, row, row.id);
    }
    return idx;
}

function addName(idx, descriptor, row, id) {
    const display = row[descriptor.displayKey];
    if (isBlank(display)) return;
    const key = String(display).trim().toLowerCase();
    if (idx.byName.has(key) && idx.byName.get(key) !== id) {
        idx.byName.set(key, AMBIGUOUS);
    } else {
        idx.byName.set(key, id);
    }
}

// Natural keys are only unique in the common case (a real name/title). Two
// rows resolving to the same key (e.g. both untitled) must not silently
// collapse into one — mark the key ambiguous so the importer is told to
// disambiguate with a uid instead of quietly overwriting one of them.
function setNat(idx, natKey, row) {
    const existing = idx.rowsByNat.get(natKey);
    if (existing && existing !== AMBIGUOUS && existing.id !== row.id) {
        idx.rowsByNat.set(natKey, AMBIGUOUS);
    } else if (existing !== AMBIGUOUS) {
        idx.rowsByNat.set(natKey, row);
    }
}

function registerRow(idx, descriptor, instance, id) {
    if (instance.uid) {
        idx.byUid.set(instance.uid, id);
        idx.rowsByUid.set(instance.uid, instance);
    }
    setNat(idx, descriptor.naturalKey(instance), instance);
    addName(idx, descriptor, instance, id);
}

function makeCtx(refMap, resourceReport, descriptor, row) {
    const ctx = { rowFailed: false, __report: resourceReport, row };
    ctx.resolveRef = (resource, token, columnHeader) => {
        const idx = refMap[resource];
        if (!idx) {
            fail(`references "${resource}" which is not part of this import`);
            return null;
        }
        if (token.toLowerCase().startsWith('uid:')) {
            const wanted = token.slice(4).trim();
            if (idx.byUid.has(wanted)) return idx.byUid.get(wanted);
            fail(`no ${resource} with uid "${wanted}"`);
            return null;
        }
        const nameKey = token.trim().toLowerCase();
        const hit = idx.byName.get(nameKey);
        if (hit === AMBIGUOUS) {
            fail(
                `"${token}" matches multiple ${resource} — use "uid:<uid>" instead`
            );
            return null;
        }
        if (hit === undefined) {
            fail(`no ${resource} named "${token}"`);
            return null;
        }
        return hit;

        function fail(msg) {
            ctx.rowFailed = true;
            addError(resourceReport, descriptor, row, columnHeader, msg);
        }
    };
    return ctx;
}

function buildAttrs(descriptor, row, ctx, { deferred, only = false }) {
    const attrs = {};
    for (const column of descriptor.columns) {
        if (column.kind === 'tags') continue;
        const isDeferred = !!column.deferred;
        if (only && !isDeferred) continue;
        if (!only && isDeferred && !deferred) continue;

        const raw = row.cells[column.header];
        try {
            const value = column.fromCell(raw, ctx);
            if (column.required && isBlank(value)) {
                ctx.rowFailed = true;
                addError(
                    ctx.__report,
                    descriptor,
                    row,
                    column.header,
                    'is required'
                );
            }
            if (value !== null || column.identity || only) {
                attrs[column.field] = value;
            }
        } catch (err) {
            ctx.rowFailed = true;
            addError(ctx.__report, descriptor, row, column.header, err.message);
        }
    }
    return attrs;
}

function diffAttrs(descriptor, existing, attrs) {
    const changes = {};
    for (const column of descriptor.columns) {
        if (column.kind === 'tags' || column.identity) continue;
        if (column.deferred) continue;
        if (!(column.field in attrs)) continue;
        if (!valuesEqual(existing[column.field], attrs[column.field])) {
            changes[column.field] = attrs[column.field];
        }
    }
    return changes;
}

function scheduleDeferred(list, descriptor, row, instance, commit) {
    const hasDeferred = descriptor.columns.some(
        (c) => c.deferred && !isBlank(row.cells[c.header])
    );
    if (hasDeferred) list.push({ row, instance, commit });
}

function sanitizeTags(rawCell, report, descriptor, row) {
    if (isBlank(rawCell)) return [];
    const names = String(rawCell)
        .split(/[,;\n]/)
        .map((v) => v.trim())
        .filter(Boolean);
    const clean = [];
    for (const name of names) {
        const res = validateTagName(name);
        if (!res.valid) {
            addError(report, descriptor, row, 'tags', `${name}: ${res.error}`);
        } else {
            clean.push(res.name);
        }
    }
    return clean;
}

function tagsDiffer(currentTags, nextNames) {
    const a = currentTags
        .map((t) => t.name.toLowerCase())
        .sort()
        .join('|');
    const b = nextNames
        .map((n) => n.toLowerCase())
        .sort()
        .join('|');
    return a !== b;
}

async function applyTags(instance, userId, names, transaction) {
    const ids = await repository.findOrCreateTags(userId, names, transaction);
    await instance.setTags(ids, { transaction });
}

function addError(report, descriptor, row, columnHeader, message) {
    report.errors.push({
        sheet: descriptor.sheet,
        row: row.rowNum,
        column: columnHeader || '',
        message,
    });
}

function summarize(report) {
    const t = {
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
        pendingDeletes: 0,
    };
    for (const r of Object.values(report)) {
        t.created += r.created;
        t.updated += r.updated;
        t.unchanged += r.unchanged;
        t.errors += r.errors.length;
        t.pendingDeletes += r.pendingDeletes;
    }
    return t;
}

module.exports = { run };
