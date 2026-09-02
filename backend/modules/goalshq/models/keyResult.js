'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_key_results — polymorphic measurable targets attached to either a
 * goal or a strategy (parent_type). Drives `progress_mode: 'metric'`.
 */
module.exports = (sequelize) => {
    const KeyResult = sequelize.define(
        'GoalshqKeyResult',
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
            parent_type: {
                type: DataTypes.ENUM('goal', 'strategy'),
                allowNull: false,
            },
            parent_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            unit: {
                type: DataTypes.STRING(40),
                allowNull: true,
            },
            direction: {
                type: DataTypes.ENUM('increase', 'decrease', 'maintain'),
                allowNull: false,
                defaultValue: 'increase',
            },
            baseline_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            target_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
            },
            current_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            sort_order: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
        },
        {
            tableName: 'goalshq_key_results',
            indexes: [
                { fields: ['parent_type', 'parent_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return KeyResult;
};
