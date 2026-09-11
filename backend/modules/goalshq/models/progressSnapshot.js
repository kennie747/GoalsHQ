'use strict';

const { DataTypes } = require('sequelize');

/**
 * goalshq_progress_snapshots — one row per (parent, user-local day) capturing a
 * goal's, strategy's, or project's computed percent + health. Powers trend
 * lines and seeds the future daily-archive feature. Deliberately NOT extended
 * to Task — tasks are too short-lived/numerous for a daily snapshot to be
 * worth the row growth (see docs/goalshq/adr/0002-first-class-integration.md,
 * Phase A Follow-up AF3).
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
                // goal | strategy | project (app-validated)
                type: DataTypes.STRING(20),
                allowNull: false,
            },
            kind: {
                type: DataTypes.ENUM('execution', 'outcome'),
                allowNull: false,
                defaultValue: 'execution',
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
                    fields: [
                        'parent_type',
                        'parent_id',
                        'kind',
                        'snapshot_date',
                    ],
                },
                { fields: ['user_id'] },
            ],
        }
    );

    return ProgressSnapshot;
};
