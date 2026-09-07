'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

/**
 * Phase D — carryover/rescheduling. One row per "overdue episode" for a task:
 * created once when a task is first classified, left alone (not duplicated)
 * while it's pending review, and only replaced by a fresh row if the task
 * becomes overdue again in a later episode after being reviewed. This is what
 * keeps the review queue from growing unbounded — see
 * docs/goalshq/adr/0002-first-class-integration.md for the broader
 * first-class-integration context this was built under.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'task_carryover_events', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            task_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'tasks', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            occurred_on: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },
            classification: {
                type: Sequelize.ENUM('resurface', 'reschedule', 'drop'),
                allowNull: false,
            },
            previous_due_date: {
                type: Sequelize.DATEONLY,
                allowNull: true,
            },
            new_due_date: {
                type: Sequelize.DATEONLY,
                allowNull: true,
            },
            source: {
                type: Sequelize.ENUM('auto', 'user_override'),
                allowNull: false,
                defaultValue: 'auto',
            },
            reviewed_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await safeAddIndex(
            queryInterface,
            'task_carryover_events',
            ['task_id'],
            { name: 'task_carryover_events_task_id_idx' }
        );
        await safeAddIndex(
            queryInterface,
            'task_carryover_events',
            ['user_id', 'reviewed_at'],
            { name: 'task_carryover_events_user_pending_idx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('task_carryover_events');
    },
};
