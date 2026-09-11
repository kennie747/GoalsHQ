'use strict';

const {
    safeAddColumns,
    safeChangeColumn,
    safeCreateTable,
    safeAddIndex,
    safeRemoveColumn,
} = require('../utils/migration-utils');

/**
 * KR trees + record-driven KR sources + milestone auto-achieve.
 *
 * - key_results: `parent_kr_id` (self-FK) + `auto_source` relaxed to a plain
 *   string (app-validated: manual | tasks_done_count | record_sum |
 *   record_count | child_kr_sum).
 * - milestones: `completion_mode` (all|any), `auto_kr_id` + `auto_kr_threshold`,
 *   `auto_achieved` marker.
 * - goalshq_milestone_tasks: which task(s) a milestone auto-achieves from.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeAddColumns(queryInterface, 'goalshq_key_results', [
            {
                name: 'parent_kr_id',
                definition: { type: Sequelize.INTEGER, allowNull: true },
            },
        ]);
        await safeChangeColumn(
            queryInterface,
            'goalshq_key_results',
            'auto_source',
            {
                type: Sequelize.STRING(30),
                allowNull: false,
                defaultValue: 'manual',
            }
        );
        await safeAddIndex(queryInterface, 'goalshq_key_results', [
            'parent_kr_id',
        ]);

        await safeAddColumns(queryInterface, 'goalshq_milestones', [
            {
                name: 'completion_mode',
                definition: {
                    type: Sequelize.STRING(10),
                    allowNull: false,
                    defaultValue: 'all',
                },
            },
            {
                name: 'auto_kr_id',
                definition: { type: Sequelize.INTEGER, allowNull: true },
            },
            {
                name: 'auto_kr_threshold',
                definition: { type: Sequelize.FLOAT, allowNull: true },
            },
            {
                name: 'auto_achieved',
                definition: {
                    type: Sequelize.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            },
        ]);

        await safeCreateTable(queryInterface, 'goalshq_milestone_tasks', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            milestone_id: { type: Sequelize.INTEGER, allowNull: false },
            task_id: { type: Sequelize.INTEGER, allowNull: false },
            user_id: { type: Sequelize.INTEGER, allowNull: false },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });
        await safeAddIndex(
            queryInterface,
            'goalshq_milestone_tasks',
            ['milestone_id', 'task_id'],
            { unique: true, name: 'goalshq_milestone_tasks_uidx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_milestone_tasks');
        for (const c of [
            'completion_mode',
            'auto_kr_id',
            'auto_kr_threshold',
            'auto_achieved',
        ]) {
            await safeRemoveColumn(queryInterface, 'goalshq_milestones', c);
        }
        await safeRemoveColumn(
            queryInterface,
            'goalshq_key_results',
            'parent_kr_id'
        );
    },
};
