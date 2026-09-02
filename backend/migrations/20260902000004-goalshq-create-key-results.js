'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_key_results', {
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
            parent_type: {
                type: Sequelize.ENUM('goal', 'strategy'),
                allowNull: false,
            },
            parent_id: { type: Sequelize.INTEGER, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            name: { type: Sequelize.STRING(255), allowNull: false },
            unit: { type: Sequelize.STRING(40), allowNull: true },
            direction: {
                type: Sequelize.ENUM('increase', 'decrease', 'maintain'),
                allowNull: false,
                defaultValue: 'increase',
            },
            baseline_value: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            target_value: { type: Sequelize.FLOAT, allowNull: false },
            current_value: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
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

        await safeAddIndex(
            queryInterface,
            'goalshq_key_results',
            ['parent_type', 'parent_id'],
            { name: 'goalshq_key_results_parent_idx' }
        );
        await safeAddIndex(queryInterface, 'goalshq_key_results', ['user_id'], {
            name: 'goalshq_key_results_user_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_key_results');
    },
};
