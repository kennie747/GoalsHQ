'use strict';

const {
    safeAddColumns,
    safeRemoveColumn,
} = require('../utils/migration-utils');

/**
 * "Expand into task" becomes idempotent: a milestone remembers the single task
 * it spawned via `expanded_task_id`. While that task still exists the expand
 * action is a no-op (the UI shows "Task created" instead of the icon), so the
 * button can never fan out into duplicate tasks. Cleared (app-side + gcOrphans)
 * when the task is deleted. No DB-level FK — consistent with the rest of the
 * goalshq schema (see gcOrphans()).
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeAddColumns(queryInterface, 'goalshq_milestones', [
            {
                name: 'expanded_task_id',
                definition: { type: Sequelize.INTEGER, allowNull: true },
            },
        ]);
    },

    async down(queryInterface) {
        await safeRemoveColumn(
            queryInterface,
            'goalshq_milestones',
            'expanded_task_id'
        );
    },
};
