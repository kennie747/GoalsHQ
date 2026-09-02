'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_milestones — polymorphic checkpoints attached to a goal or a strategy.
 * Drives `progress_mode: 'milestones'` (achieved / total).
 */
module.exports = (sequelize) => {
    const Milestone = sequelize.define(
        'GoalshqMilestone',
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
            title: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            target_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            target_value: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM('pending', 'achieved', 'missed'),
                allowNull: false,
                defaultValue: 'pending',
            },
            achieved_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            sort_order: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
        },
        {
            tableName: 'goalshq_milestones',
            indexes: [
                { fields: ['parent_type', 'parent_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return Milestone;
};
