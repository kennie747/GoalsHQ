'use strict';

const {
    safeAddColumns,
    safeRemoveColumn,
} = require('../utils/migration-utils');

/**
 * Progress snapshots now distinguish the execution number from the outcome
 * number (a goal/project/strategy can have both). Adds `kind` and widens the
 * per-day unique key to include it. `parent_type` is already a plain TEXT
 * column (no CHECK), so nothing to change there.
 */
const OLD_IDX = 'goalshq_progress_snapshots_parent_date_uidx';
const NEW_IDX = 'goalshq_progress_snapshots_parent_kind_date_uidx';

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeAddColumns(queryInterface, 'goalshq_progress_snapshots', [
            {
                name: 'kind',
                definition: {
                    type: Sequelize.ENUM('execution', 'outcome'),
                    allowNull: false,
                    defaultValue: 'execution',
                },
            },
        ]);

        for (const name of [OLD_IDX, NEW_IDX]) {
            try {
                await queryInterface.removeIndex(
                    'goalshq_progress_snapshots',
                    name
                );
            } catch (e) {
                /* not present */
            }
        }
        await queryInterface.addIndex('goalshq_progress_snapshots', {
            fields: ['parent_type', 'parent_id', 'kind', 'snapshot_date'],
            unique: true,
            name: NEW_IDX,
        });
    },

    async down(queryInterface) {
        for (const name of [NEW_IDX, OLD_IDX]) {
            try {
                await queryInterface.removeIndex(
                    'goalshq_progress_snapshots',
                    name
                );
            } catch (e) {
                /* not present */
            }
        }
        await queryInterface.sequelize.query(
            `DELETE FROM goalshq_progress_snapshots WHERE kind = 'outcome'`
        );
        // safeRemoveColumn rebuilds the table (dropping named indexes with it),
        // so drop `kind` first, then re-create the narrow unique index.
        try {
            await safeRemoveColumn(
                queryInterface,
                'goalshq_progress_snapshots',
                'kind'
            );
        } catch (e) {
            /* column may already be gone */
        }
        try {
            await queryInterface.addIndex('goalshq_progress_snapshots', {
                fields: ['parent_type', 'parent_id', 'snapshot_date'],
                unique: true,
                name: OLD_IDX,
            });
        } catch (e) {
            /* index may already exist */
        }
    },
};
