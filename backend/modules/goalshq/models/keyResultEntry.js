'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_key_result_entries — a KR's check-in history. Each entry is a dated
 * absolute `value`; the KR's current_value follows the latest entry (unless an
 * auto_source overrides it). Powers the KR sparkline / actual-vs-target line.
 */
module.exports = (sequelize) => {
    const KeyResultEntry = sequelize.define(
        'GoalshqKeyResultEntry',
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
            key_result_id: { type: DataTypes.INTEGER, allowNull: false },
            user_id: { type: DataTypes.INTEGER, allowNull: false },
            entry_date: { type: DataTypes.DATEONLY, allowNull: false },
            value: { type: DataTypes.FLOAT, allowNull: false },
            note: { type: DataTypes.TEXT, allowNull: true },
        },
        {
            tableName: 'goalshq_key_result_entries',
            updatedAt: false,
            indexes: [{ fields: ['key_result_id', 'entry_date'] }],
        }
    );

    return KeyResultEntry;
};
