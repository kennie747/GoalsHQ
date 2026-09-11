'use strict';

const { BY_KEY, orderedKeys, withDependencies } = require('./registry');
const repository = require('../repository');

/**
 * Load and serialize the user's rows for the requested resources into the
 * shape the workbook / CSV writers expect: plain objects whose ref columns
 * already carry a human-readable parent name in `__refs`.
 *
 * Dependency resources (e.g. Projects when exporting only Tasks) are loaded
 * read-only so foreign keys can be rendered as names.
 */
async function collectRows(userId, scopeKeys) {
    const emitKeys = orderedKeys(scopeKeys);
    const loadKeys = withDependencies(emitKeys);

    const loaded = {};
    const displayById = {};
    const uidById = {};
    for (const key of loadKeys) {
        const descriptor = BY_KEY[key];
        const rows = await repository.loadAll(descriptor, userId);
        loaded[key] = rows;
        displayById[key] = new Map(
            rows.map((r) => [r.id, r[descriptor.displayKey]])
        );
        uidById[key] = new Map(rows.map((r) => [r.id, r.uid]));
    }

    const out = {};
    for (const key of emitKeys) {
        const descriptor = BY_KEY[key];
        out[key] = loaded[key].map((row) => {
            const plain = row.toJSON();
            plain.__refs = {};
            for (const column of descriptor.columns) {
                if (column.kind !== 'ref') continue;
                const targetId = plain[column.field];
                if (targetId == null) continue;
                // A polymorphic reference's target resource depends on a
                // sibling column (e.g. parent_type) already on the row.
                const resource =
                    typeof column.ref.resource === 'function'
                        ? column.ref.resource(plain)
                        : column.ref.resource;
                if (!resource) continue;
                const name = displayById[resource]?.get(targetId);
                const uid = uidById[resource]?.get(targetId);
                plain.__refs[column.field] = name || (uid ? `uid:${uid}` : '');
            }
            return plain;
        });
    }
    return out;
}

module.exports = { collectRows };
