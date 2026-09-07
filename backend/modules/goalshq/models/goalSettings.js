'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_goal_settings — 1:1 extension of a tududi Goal holding the strategic
 * / measurement attributes core `goals` lacks. Row is created lazily the first
 * time GoalsHQ touches a goal. Associated to Goal in backend/models/index.js.
 */
module.exports = (sequelize) => {
    const GoalSettings = sequelize.define(
        'GoalshqGoalSettings',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            goal_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            progress_mode: {
                type: DataTypes.ENUM(
                    'rollup_strategies',
                    'rollup_projects',
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_strategies',
            },
            importance: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 3,
            },
            weight_by_priority: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            start_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            manual_percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            cached_percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            cached_health: {
                type: DataTypes.ENUM(
                    'on_track',
                    'at_risk',
                    'off_track',
                    'no_data'
                ),
                allowNull: true,
            },
            cached_computed_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        },
        {
            tableName: 'goalshq_goal_settings',
            indexes: [
                { unique: true, fields: ['goal_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return GoalSettings;
};
