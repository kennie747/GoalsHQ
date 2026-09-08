'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_records — the raw dated ledger (Part 2, Alternative C). One
 * fixed-schema table scoped to a goal / strategy / project; the frontend
 * "template" presets (Build Log, Contribution Ledger, Register) just change
 * which columns are shown. Feeds Key Results via `counts_toward_kr_id` +
 * `auto_source: record_sum|record_count`. Evidence FILES live in the
 * polymorphic `attachments` table (parent_type = 'goalshq_record');
 * `evidence_url` is a plain external link.
 *
 * No DB-level FK on parent_id — cleaned up by gcOrphans() like the other
 * polymorphic GoalsHQ tables.
 */
module.exports = (sequelize) => {
    const Record = sequelize.define(
        'GoalshqRecord',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: DataTypes.STRING(15),
                allowNull: false,
                unique: true,
                defaultValue: uid,
            },
            parent_type: { type: DataTypes.STRING(20), allowNull: false },
            parent_id: { type: DataTypes.INTEGER, allowNull: false },
            user_id: { type: DataTypes.INTEGER, allowNull: false },
            record_date: { type: DataTypes.DATEONLY, allowNull: false },
            title: { type: DataTypes.STRING(255), allowNull: false },
            category: { type: DataTypes.STRING(120), allowNull: true },
            amount: { type: DataTypes.FLOAT, allowNull: true },
            unit: { type: DataTypes.STRING(40), allowNull: true },
            status: { type: DataTypes.STRING(60), allowNull: true },
            counts_toward_kr_id: { type: DataTypes.INTEGER, allowNull: true },
            evidence_url: { type: DataTypes.TEXT, allowNull: true },
            task_id: { type: DataTypes.INTEGER, allowNull: true },
            note_id: { type: DataTypes.INTEGER, allowNull: true },
            body: { type: DataTypes.TEXT, allowNull: true },
            created_by: { type: DataTypes.INTEGER, allowNull: true },
        },
        {
            tableName: 'goalshq_records',
            indexes: [
                { fields: ['parent_type', 'parent_id', 'record_date'] },
                { fields: ['counts_toward_kr_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return Record;
};
