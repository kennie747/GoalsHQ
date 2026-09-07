'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_milestones — polymorphic checkpoints attached to a goal, strategy,
 * or project (parent_type). Drives `progress_mode: 'milestones'` (achieved /
 * total). Deliberately NOT extended to Task — a task already has a due date
 * and a status, so a task-level Milestone would be a redundant second way to
 * say the same thing (see docs/goalshq/adr/0002-first-class-integration.md,
 * Phase A Follow-up AF3). Scoped hasMany associations from
 * Goal/GoalshqStrategy/Project are declared in backend/models/index.js (no
 * DB-level FK on parent_id — see gcOrphans()).
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
                type: DataTypes.ENUM('goal', 'strategy', 'project'),
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
