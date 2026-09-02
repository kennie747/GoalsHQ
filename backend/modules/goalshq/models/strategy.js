'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_strategies — the Strategy/Outcome tier that sits between a tududi Goal
 * and its Projects. GoalsHQ-owned; no Sequelize association to core models
 * (see docs/goalshq/adr/0001-isolation-architecture.md). `goal_id` / `user_id`
 * are plain integer columns joined manually in the repository.
 */
module.exports = (sequelize) => {
    const Strategy = sequelize.define(
        'GoalshqStrategy',
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
            goal_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            kind: {
                type: DataTypes.ENUM('primary', 'secondary', 'experiment'),
                allowNull: false,
                defaultValue: 'primary',
            },
            status: {
                type: DataTypes.ENUM('active', 'paused', 'achieved', 'dropped'),
                allowNull: false,
                defaultValue: 'active',
            },
            horizon_label: {
                type: DataTypes.STRING(120),
                allowNull: true,
            },
            start_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            target_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            importance: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 3,
            },
            progress_mode: {
                type: DataTypes.ENUM(
                    'rollup_projects',
                    'rollup_tasks',
                    'metric',
                    'milestones',
                    'manual'
                ),
                allowNull: false,
                defaultValue: 'rollup_projects',
            },
            weight_by_priority: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
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
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            cached_computed_at: {
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
            tableName: 'goalshq_strategies',
            indexes: [
                { fields: ['goal_id'] },
                { fields: ['user_id'] },
                { fields: ['status'] },
            ],
        }
    );

    return Strategy;
};
