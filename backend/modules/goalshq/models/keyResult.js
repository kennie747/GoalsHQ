'use strict';

const { DataTypes } = require('sequelize');
const { uid } = require('../../../utils/uid');

/**
 * goalshq_key_results — polymorphic measurable targets attached to a goal,
 * strategy, project, or task (parent_type). Drives `progress_mode: 'metric'`
 * for goal/strategy/project; a task-parented KeyResult is informational only
 * (the "batch/quota task" primitive) and does not feed any rollup — see
 * docs/goalshq/adr/0002-first-class-integration.md, Phase A Follow-up AF3.
 * Scoped hasMany associations from Goal/GoalshqStrategy/Project/Task are
 * declared in backend/models/index.js (no DB-level FK on parent_id — see
 * gcOrphans()). SQLite ENUM columns are plain TEXT with no CHECK constraint
 * in this schema, so widening this list needs no migration.
 */
module.exports = (sequelize) => {
    const KeyResult = sequelize.define(
        'GoalshqKeyResult',
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
            parent_type: {
                type: DataTypes.ENUM('goal', 'strategy', 'project', 'task'),
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
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            unit: {
                type: DataTypes.STRING(40),
                allowNull: true,
            },
            direction: {
                type: DataTypes.ENUM('increase', 'decrease', 'maintain'),
                allowNull: false,
                defaultValue: 'increase',
            },
            // 'tasks_done_count': the rollup engine auto-sets current_value to
            // the count of done tasks in this KR's parent scope on every
            // recompute (see operations/rollup.js) — ignored for a
            // task-parented KR (informational only per Phase A Follow-up AF3,
            // never touched by recomputeGoal()).
            // manual | tasks_done_count | record_sum | record_count |
            // child_kr_sum (app-validated). A leaf KR has its own source; a
            // 'child_kr_sum' KR is a rollup of its child KRs (parent_kr_id).
            auto_source: {
                type: DataTypes.STRING(30),
                allowNull: false,
                defaultValue: 'manual',
            },
            // Self-reference for the KR tree (propagate downward).
            parent_kr_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            baseline_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            target_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
            },
            current_value: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            sort_order: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
        },
        {
            tableName: 'goalshq_key_results',
            indexes: [
                { fields: ['parent_type', 'parent_id'] },
                { fields: ['user_id'] },
                { fields: ['parent_kr_id'] },
            ],
        }
    );

    return KeyResult;
};
