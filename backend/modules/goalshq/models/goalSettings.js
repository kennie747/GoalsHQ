'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_goal_settings — 1:1 extension of a tududi Goal. Row is created lazily
 * the first time GoalsHQ touches a goal. Associated to Goal in
 * backend/models/index.js.
 *
 * A goal always has an *execution* number (task/project completion). It gets an
 * *outcome* number (Key Results / Milestones) only when `metrics_enabled` is on.
 * The two are cached separately and shown side by side — never blended.
 */
module.exports = (sequelize) => {
    const HEALTH = ['on_track', 'at_risk', 'off_track', 'no_data'];

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
            metrics_enabled: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            start_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            // Optional manual override of the execution %.
            manual_percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            cached_execution_percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            cached_execution_health: {
                type: DataTypes.ENUM(...HEALTH),
                allowNull: true,
            },
            cached_outcome_percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            cached_outcome_health: {
                type: DataTypes.ENUM(...HEALTH),
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
