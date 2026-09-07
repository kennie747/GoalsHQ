'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_project_settings — 1:1 extension of a tududi Project giving it the
 * same measurable tier Goal/Strategy already have (progress_mode + cached
 * percent/health). Row is created lazily the first time a recompute touches
 * a project (see operations/rollup.js's ensureProjectSettings). Associated to
 * Project in backend/models/index.js.
 */
module.exports = (sequelize) => {
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
            progress_mode: {
                type: DataTypes.ENUM(
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_tasks',
            },
            importance: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 3,
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
            tableName: 'goalshq_project_settings',
            indexes: [
                { unique: true, fields: ['project_id'] },
                { fields: ['user_id'] },
            ],
        }
    );

    return ProjectSettings;
};
