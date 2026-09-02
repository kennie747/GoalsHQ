'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_strategies', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: Sequelize.STRING(15),
                allowNull: false,
                unique: true,
            },
            goal_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
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
            name: { type: Sequelize.STRING(255), allowNull: false },
            description: { type: Sequelize.TEXT, allowNull: true },
            kind: {
                type: Sequelize.ENUM('primary', 'secondary', 'experiment'),
                allowNull: false,
                defaultValue: 'primary',
            },
            status: {
                type: Sequelize.ENUM('active', 'paused', 'achieved', 'dropped'),
                allowNull: false,
                defaultValue: 'active',
            },
            horizon_label: { type: Sequelize.STRING(120), allowNull: true },
            start_date: { type: Sequelize.DATEONLY, allowNull: true },
            target_date: { type: Sequelize.DATEONLY, allowNull: true },
            importance: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 3,
            },
            progress_mode: {
                type: Sequelize.ENUM(
                    'rollup_projects',
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_projects',
            },
            weight_by_priority: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            manual_percent: { type: Sequelize.FLOAT, allowNull: true },
            cached_percent: { type: Sequelize.FLOAT, allowNull: true },
            cached_health: { type: Sequelize.STRING(20), allowNull: true },
            cached_computed_at: { type: Sequelize.DATE, allowNull: true },
            sort_order: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
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

        await safeAddIndex(queryInterface, 'goalshq_strategies', ['goal_id'], {
            name: 'goalshq_strategies_goal_id_idx',
        });
        await safeAddIndex(queryInterface, 'goalshq_strategies', ['user_id'], {
            name: 'goalshq_strategies_user_id_idx',
        });
        await safeAddIndex(queryInterface, 'goalshq_strategies', ['status'], {
            name: 'goalshq_strategies_status_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_strategies');
    },
};
