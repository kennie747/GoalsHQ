'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

/**
 * Part of Phase A Follow-up (see docs/goalshq/adr/0002-first-class-integration.md).
 *
 * Project gets the same measurable tier Goal/Strategy already have — a
 * progress_mode + cached percent/health, extending to KeyResult/Milestone via
 * `parent_type: 'project'` (widened at the model/JS level only: SQLite ENUM
 * columns in this schema are plain TEXT with no CHECK constraint, confirmed
 * against the live dev DB, so no rebuild migration is needed for that part).
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_project_settings', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'projects', key: 'id' },
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
            progress_mode: {
                type: Sequelize.ENUM(
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_tasks',
            },
            importance: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 3,
            },
            manual_percent: { type: Sequelize.FLOAT, allowNull: true },
            cached_percent: { type: Sequelize.FLOAT, allowNull: true },
            cached_health: {
                type: Sequelize.ENUM(
                    'on_track',
                    'at_risk',
                    'off_track',
                    'no_data'
                ),
                allowNull: true,
            },
            cached_computed_at: { type: Sequelize.DATE, allowNull: true },
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
            'goalshq_project_settings',
            ['project_id'],
            { name: 'goalshq_project_settings_project_id_uidx', unique: true }
        );
        await safeAddIndex(
            queryInterface,
            'goalshq_project_settings',
            ['user_id'],
            { name: 'goalshq_project_settings_user_id_idx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_project_settings');
    },
};
