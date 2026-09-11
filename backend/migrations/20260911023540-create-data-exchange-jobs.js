'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

/**
 * History of Data Exchange (spreadsheet import/export) operations — see
 * docs/16-data-exchange.md. One row per export or successful import commit;
 * previews are not logged.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'data_exchange_jobs', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true,
            },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            direction: {
                type: Sequelize.ENUM('export', 'import'),
                allowNull: false,
            },
            format: {
                type: Sequelize.ENUM('xlsx', 'csv'),
                allowNull: false,
            },
            scopes: {
                type: Sequelize.JSON,
                allowNull: false,
            },
            mode: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            filename: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            status: {
                type: Sequelize.ENUM('success', 'error'),
                allowNull: false,
                defaultValue: 'success',
            },
            stats: {
                type: Sequelize.JSON,
                allowNull: true,
            },
            error_message: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        await safeAddIndex(
            queryInterface,
            'data_exchange_jobs',
            ['user_id', 'created_at'],
            { name: 'data_exchange_jobs_user_created_idx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('data_exchange_jobs');
    },
};
