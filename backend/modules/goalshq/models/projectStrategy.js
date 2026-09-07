'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_project_strategies — many-to-many link between a tududi Project and
 * a GoalsHQ Strategy. A project may serve several strategies at once; the same
 * (strategy_id, project_id) pair may only be linked once. Stored as our own
 * join table so tududi's `projects` schema is never modified.
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
                { fields: ['project_id'] },
                {
                    unique: true,
                    fields: ['strategy_id', 'project_id'],
                    name: 'goalshq_project_strategies_strategy_project_uidx',
                },
            ],
        }
    );

    return ProjectStrategy;
};
