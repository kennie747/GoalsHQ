'use strict';

const { Tag } = require('../../models');

/**
 * Thin, generic data access for the Data Exchange engine. Everything is
 * hard-scoped to a single user_id — the engine never sees another tenant's rows.
 */
class DataExchangeRepository {
    /**
     * Load every row of a resource for a user, with Tags eager-loaded when the
     * descriptor declares a tagField.
     */
    async loadAll(descriptor, userId, transaction = null) {
        const where = { user_id: userId, ...(descriptor.exportWhere || {}) };
        const options = { where, transaction };
        if (descriptor.tagField) {
            options.include = [
                { model: Tag, through: { attributes: [] }, required: false },
            ];
        }
        if (descriptor.exportOrder) options.order = descriptor.exportOrder;
        const rows = await descriptor.model.findAll(options);
        return descriptor.skipRow
            ? rows.filter((r) => !descriptor.skipRow(r))
            : rows;
    }

    async findOrCreateTags(userId, names, transaction) {
        const ids = [];
        for (const name of names) {
            const [tag] = await Tag.findOrCreate({
                where: { user_id: userId, name },
                defaults: { user_id: userId, name },
                transaction,
            });
            ids.push(tag.id);
        }
        return ids;
    }
}

module.exports = new DataExchangeRepository();
