'use strict';

const { DataTypes } = require('sequelize');

/**
 * task_carryover_events — one row per "overdue episode" for a task. Created
 * once when the daily classifier first flags a task as resurface/reschedule/
 * drop; left alone (not duplicated) while `reviewed_at` is null; a fresh row
 * is only created if the task becomes overdue again in a later episode after
 * being reviewed. See backend/modules/tasks/carryover/service.js.
 */
module.exports = (sequelize) => {
    const TaskCarryoverEvent = sequelize.define(
        'TaskCarryoverEvent',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            task_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            occurred_on: {
                type: DataTypes.DATEONLY,
                allowNull: false,
            },
            classification: {
                type: DataTypes.ENUM('resurface', 'reschedule', 'drop'),
                allowNull: false,
            },
            previous_due_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            new_due_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            source: {
                type: DataTypes.ENUM('auto', 'user_override'),
                allowNull: false,
                defaultValue: 'auto',
            },
            reviewed_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        },
        {
            tableName: 'task_carryover_events',
            indexes: [
                { fields: ['task_id'] },
                { fields: ['user_id', 'reviewed_at'] },
            ],
        }
    );

    return TaskCarryoverEvent;
};
