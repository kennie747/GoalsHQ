'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_project_strategies — links a tududi Project to a GoalsHQ Strategy.
 * A project belongs to at most one strategy (unique project_id). Stored as our
 * own join table so tududi's `projects` schema is never modified.
 */
module.exports = (sequelize) => {
    const ProjectStrategy = sequelize.define(
        'GoalshqProjectStrategy',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            strategy_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            project_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            weight: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 1,
            },
        },
        {
            tableName: 'goalshq_project_strategies',
            indexes: [
                { fields: ['strategy_id'] },
                { fields: ['user_id'] },
                { unique: true, fields: ['project_id'] },
            ],
        }
    );

    return ProjectStrategy;
};
