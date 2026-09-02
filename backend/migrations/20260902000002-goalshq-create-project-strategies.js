'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_project_strategies', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            strategy_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'goalshq_strategies', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            project_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
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
            weight: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 1,
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
            'goalshq_project_strategies',
            ['strategy_id'],
            { name: 'goalshq_project_strategies_strategy_id_idx' }
        );
        await safeAddIndex(
            queryInterface,
            'goalshq_project_strategies',
            ['user_id'],
            { name: 'goalshq_project_strategies_user_id_idx' }
        );
        await safeAddIndex(
            queryInterface,
            'goalshq_project_strategies',
            ['project_id'],
            {
                name: 'goalshq_project_strategies_project_id_uidx',
                unique: true,
            }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_project_strategies');
    },
};
