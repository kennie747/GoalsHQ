'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_strategies — a grouping bucket that collects the projects pursuing one
 * broad approach ("Real Estate", "Systems Security"). It is NOT a measured
 * rollup tier (see docs/goalshq/adr/0003-strategy-as-grouping.md, which
 * supersedes 0002's measured-tier design).
 *
 * - `goal_id` is optional ("No Goal", mirroring goals.area_id).
 * - Strategy <-> Project is many-to-many via goalshq_project_strategies.
 * - `cached_percent` / `cached_health` hold a *grouping summary* only: the
 *   unweighted mean of the linked projects' execution %. It is display-only and
 *   never contributes to the parent goal's number.
 *
 * Associations (Goal, Project) are declared in backend/models/index.js.
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
                allowNull: true,
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
            color: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM('active', 'paused', 'achieved', 'dropped'),
                allowNull: false,
                defaultValue: 'active',
            },
            // When false, this strategy's Key Results / Milestones render
            // read-only (still shown "for context", never rolled into a goal).
            metrics_editable: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
            // Grouping summary = unweighted mean of linked projects' execution %.
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
