'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_milestones', {
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
            title: { type: Sequelize.STRING(255), allowNull: false },
            target_date: { type: Sequelize.DATEONLY, allowNull: true },
            target_value: { type: Sequelize.FLOAT, allowNull: true },
            status: {
                type: Sequelize.ENUM('pending', 'achieved', 'missed'),
                allowNull: false,
                defaultValue: 'pending',
            },
            achieved_at: { type: Sequelize.DATE, allowNull: true },
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
            'goalshq_milestones',
            ['parent_type', 'parent_id'],
            { name: 'goalshq_milestones_parent_idx' }
        );
        await safeAddIndex(queryInterface, 'goalshq_milestones', ['user_id'], {
            name: 'goalshq_milestones_user_id_idx',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_milestones');
    },
};
