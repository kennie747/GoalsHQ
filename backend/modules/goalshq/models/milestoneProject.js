'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_milestone_projects — which whole project(s) a milestone auto-achieves
 * from. Unlike goalshq_milestone_tasks (a fixed task-id list), a project link is
 * expanded to the project's LIVE task set every time the rollup evaluates the
 * milestone, so tasks added/removed later stay accounted for.
 */
module.exports = (sequelize) => {
    const MilestoneProject = sequelize.define(
        'GoalshqMilestoneProject',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            milestone_id: { type: DataTypes.INTEGER, allowNull: false },
            project_id: { type: DataTypes.INTEGER, allowNull: false },
            user_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
            tableName: 'goalshq_milestone_projects',
            updatedAt: false,
            indexes: [{ unique: true, fields: ['milestone_id', 'project_id'] }],
        }
    );

    return MilestoneProject;
};
