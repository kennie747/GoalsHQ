'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

/**
 * The Records ledger + Key Result check-in history (Part 2 — Alternative C).
 *
 * `goalshq_records` is one fixed-schema dated table scoped to a Goal / Strategy
 * / Project. Templates (Build Log, Contribution Ledger, Register) are UI
 * presets over the same columns. Evidence files live in the polymorphic
 * `attachments` table (parent_type = 'goalshq_record'); `evidence_url` is a
 * plain external link.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_records', {
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
            parent_type: { type: Sequelize.STRING(20), allowNull: false },
            parent_id: { type: Sequelize.INTEGER, allowNull: false },
            user_id: { type: Sequelize.INTEGER, allowNull: false },
            record_date: { type: Sequelize.DATEONLY, allowNull: false },
            title: { type: Sequelize.STRING(255), allowNull: false },
            category: { type: Sequelize.STRING(120), allowNull: true },
            amount: { type: Sequelize.FLOAT, allowNull: true },
            unit: { type: Sequelize.STRING(40), allowNull: true },
            status: { type: Sequelize.STRING(60), allowNull: true },
            counts_toward_kr_id: { type: Sequelize.INTEGER, allowNull: true },
            evidence_url: { type: Sequelize.TEXT, allowNull: true },
            task_id: { type: Sequelize.INTEGER, allowNull: true },
            note_id: { type: Sequelize.INTEGER, allowNull: true },
            body: { type: Sequelize.TEXT, allowNull: true },
            created_by: { type: Sequelize.INTEGER, allowNull: true },
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
        await safeAddIndex(queryInterface, 'goalshq_records', [
            'parent_type',
            'parent_id',
            'record_date',
        ]);
        await safeAddIndex(queryInterface, 'goalshq_records', [
            'counts_toward_kr_id',
        ]);
        await safeAddIndex(queryInterface, 'goalshq_records', ['user_id']);

        await safeCreateTable(queryInterface, 'goalshq_key_result_entries', {
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
            key_result_id: { type: Sequelize.INTEGER, allowNull: false },
            user_id: { type: Sequelize.INTEGER, allowNull: false },
            entry_date: { type: Sequelize.DATEONLY, allowNull: false },
            value: { type: Sequelize.FLOAT, allowNull: false },
            note: { type: Sequelize.TEXT, allowNull: true },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });
        await safeAddIndex(queryInterface, 'goalshq_key_result_entries', [
            'key_result_id',
            'entry_date',
        ]);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_key_result_entries');
        await queryInterface.dropTable('goalshq_records');
    },
};
