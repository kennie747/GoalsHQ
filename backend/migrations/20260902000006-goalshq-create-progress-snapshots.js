'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_progress_snapshots', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
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
            snapshot_date: { type: Sequelize.DATEONLY, allowNull: false },
            percent: { type: Sequelize.FLOAT, allowNull: true },
            health: { type: Sequelize.STRING(20), allowNull: true },
            source: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'cron',
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await safeAddIndex(
            queryInterface,
            'goalshq_progress_snapshots',
            ['parent_type', 'parent_id', 'snapshot_date'],
            {
                name: 'goalshq_progress_snapshots_parent_date_uidx',
                unique: true,
            }
        );
        await safeAddIndex(
            queryInterface,
            'goalshq_progress_snapshots',
            ['user_id'],
            { name: 'goalshq_progress_snapshots_user_id_idx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_progress_snapshots');
    },
};
