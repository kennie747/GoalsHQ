'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_goal_settings', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            goal_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
                references: { model: 'goals', key: 'id' },
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
                    'rollup_strategies',
                    'rollup_projects',
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_strategies',
            },
            importance: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 3,
            },
            weight_by_priority: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            start_date: { type: Sequelize.DATEONLY, allowNull: true },
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
            'goalshq_goal_settings',
            ['goal_id'],
            { name: 'goalshq_goal_settings_goal_id_uidx', unique: true }
        );
        await safeAddIndex(
            queryInterface,
            'goalshq_goal_settings',
            ['user_id'],
            { name: 'goalshq_goal_settings_user_id_idx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_goal_settings');
    },
};
