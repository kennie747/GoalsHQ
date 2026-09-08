'use strict';

const { safeAddColumns, safeAddIndex } = require('../utils/migration-utils');

/**
 * Generalize `task_attachments` into a polymorphic `attachments` table so a
 * GoalsHQ Record (and, later, other entities) can own uploaded files — reusing
 * the whole existing multer / whitelist / preview / download stack.
 *
 * - rename the table
 * - add `parent_type` (default 'task') + `parent_id` (backfilled from task_id)
 * - `task_id` stays (nullable) for one release; the model reads parent_*.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const q = queryInterface.sequelize;
        const tables = await queryInterface.showAllTables();

        if (
            tables.includes('task_attachments') &&
            !tables.includes('attachments')
        ) {
            await queryInterface.renameTable('task_attachments', 'attachments');
        }

        await safeAddColumns(queryInterface, 'attachments', [
            {
                name: 'parent_type',
                definition: {
                    type: Sequelize.STRING(30),
                    allowNull: false,
                    defaultValue: 'task',
                },
            },
            {
                name: 'parent_id',
                definition: { type: Sequelize.INTEGER, allowNull: true },
            },
        ]);

        await q.query(
            `UPDATE attachments SET parent_type = 'task', parent_id = task_id
              WHERE parent_id IS NULL AND task_id IS NOT NULL`
        );

        await safeAddIndex(queryInterface, 'attachments', [
            'parent_type',
            'parent_id',
        ]);
    },

    async down(queryInterface) {
        const { safeRemoveColumn } = require('../utils/migration-utils');
        await safeRemoveColumn(queryInterface, 'attachments', 'parent_type');
        await safeRemoveColumn(queryInterface, 'attachments', 'parent_id');
        const tables = await queryInterface.showAllTables();
        if (
            tables.includes('attachments') &&
            !tables.includes('task_attachments')
        ) {
            await queryInterface.renameTable('attachments', 'task_attachments');
        }
    },
};
