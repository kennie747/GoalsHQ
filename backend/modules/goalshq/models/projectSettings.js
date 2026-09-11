'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_project_settings — 1:1 extension of a tududi Project. Row is created
 * lazily the first time a recompute touches a project (see
 * operations/rollup.js's ensureProjectSettings). Associated to Project in
 * backend/models/index.js.
 *
 * Execution % is always the project's task completion ("Task momentum").
 * Outcome % (its own Key Results / Milestones) is shown only when
 * `metrics_enabled` is on. Cached separately.
 */
module.exports = (sequelize) => {
    const HEALTH = ['on_track', 'at_risk', 'off_track', 'no_data'];

    const ProjectSettings = sequelize.define(
        'GoalshqProjectSettings',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            project_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
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
            tableName: 'goalshq_project_settings',
            indexes: [
                { unique: true, fields: ['project_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return ProjectSettings;
};
