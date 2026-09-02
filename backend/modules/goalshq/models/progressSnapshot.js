'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_progress_snapshots — one row per (parent, user-local day) capturing a
 * goal's or strategy's computed percent + health. Powers trend lines and seeds
 * the future daily-archive feature.
 */
module.exports = (sequelize) => {
    const ProgressSnapshot = sequelize.define(
        'GoalshqProgressSnapshot',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            parent_type: {
                type: DataTypes.ENUM('goal', 'strategy'),
                allowNull: false,
            },
            parent_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            snapshot_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
            },
            percent: {
                type: DataTypes.FLOAT,
                allowNull: true,
            },
            health: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            source: {
                type: DataTypes.STRING(20),
                allowNull: false,
                defaultValue: 'cron',
            },
        },
        {
            tableName: 'goalshq_progress_snapshots',
            updatedAt: false,
            indexes: [
                {
                    unique: true,
                    fields: ['parent_type', 'parent_id', 'snapshot_date'],
                },
                { fields: ['user_id'] },
            ],
        }
    );

    return ProgressSnapshot;
};
