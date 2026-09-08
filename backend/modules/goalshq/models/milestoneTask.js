'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_milestone_tasks — which task(s) a milestone auto-achieves from
 * (see completion_mode 'all'|'any' on the milestone). The `expand → task`
 * action inserts a row here for the task it creates.
 */
module.exports = (sequelize) => {
    const MilestoneTask = sequelize.define(
        'GoalshqMilestoneTask',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            milestone_id: { type: DataTypes.INTEGER, allowNull: false },
            task_id: { type: DataTypes.INTEGER, allowNull: false },
            user_id: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
            tableName: 'goalshq_milestone_tasks',
            updatedAt: false,
            indexes: [{ unique: true, fields: ['milestone_id', 'task_id'] }],
        }
    );

    return MilestoneTask;
};
