'use strict';

/**
 * Strategy becomes a grouping bucket, not a measured rollup tier
 * (see docs/goalshq/adr/0003-strategy-as-grouping.md, superseding 0002).
 *
 * - `goal_id` becomes nullable ("No Goal", mirroring goals.area_id).
 * - adds `color` and `metrics_editable`.
 * - drops the measurement knobs (kind, progress_mode, weight_by_priority,
 *   manual_percent, importance, horizon_label, start_date, target_date).
 * - KEEPS cached_percent / cached_health / cached_computed_at — they now hold
 *   the grouping-summary average of the linked projects' execution %, never a
 *   weighted rollup and never an input to the goal's number.
 *
 * Done as a single SQLite table rebuild (the generic safe* helpers rebuild
 * once per dropped column and mishandle composite-unique tables).
 */

const NEW_STRATEGIES_DDL = `
CREATE TABLE goalshq_strategies_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid VARCHAR(15) NOT NULL UNIQUE,
    goal_id INTEGER,
    user_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(50),
    status TEXT NOT NULL DEFAULT 'active',
    metrics_editable TINYINT(1) NOT NULL DEFAULT 1,
    cached_percent FLOAT,
    cached_health VARCHAR(20),
    cached_computed_at DATETIME,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const OLD_STRATEGIES_DDL = `
CREATE TABLE goalshq_strategies_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid VARCHAR(15) NOT NULL UNIQUE,
    goal_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    kind TEXT NOT NULL DEFAULT 'primary',
    status TEXT NOT NULL DEFAULT 'active',
    horizon_label VARCHAR(120),
    start_date DATE,
    target_date DATE,
    importance INTEGER NOT NULL DEFAULT 3,
    progress_mode TEXT NOT NULL DEFAULT 'rollup_projects',
    weight_by_priority TINYINT(1) NOT NULL DEFAULT 0,
    manual_percent FLOAT,
    cached_percent FLOAT,
    cached_health VARCHAR(20),
    cached_computed_at DATETIME,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function rebuild(queryInterface, ddl, copyCols) {
    const q = queryInterface.sequelize;
    await q.query('PRAGMA foreign_keys = OFF;');
    await q.query('DROP TABLE IF EXISTS goalshq_strategies_new;');
    await q.query(ddl);
    await q.query(
        `INSERT INTO goalshq_strategies_new (${copyCols}) SELECT ${copyCols} FROM goalshq_strategies;`
    );
    await q.query('DROP TABLE goalshq_strategies;');
    await q.query(
        'ALTER TABLE goalshq_strategies_new RENAME TO goalshq_strategies;'
    );
    await q.query(
        'CREATE INDEX IF NOT EXISTS goalshq_strategies_goal_id ON goalshq_strategies (goal_id);'
    );
    await q.query(
        'CREATE INDEX IF NOT EXISTS goalshq_strategies_user_id ON goalshq_strategies (user_id);'
    );
    await q.query(
        'CREATE INDEX IF NOT EXISTS goalshq_strategies_status ON goalshq_strategies (status);'
    );
    await q.query('PRAGMA foreign_keys = ON;');
}

module.exports = {
    async up(queryInterface) {
        const dialect = queryInterface.sequelize.getDialect();
        if (dialect !== 'sqlite') {
            // Non-sqlite path: plain column ops.
            const {
                safeAddColumns,
                safeChangeColumn,
                safeRemoveColumn,
            } = require('../utils/migration-utils');
            const { DataTypes } = require('sequelize');
            await safeAddColumns(queryInterface, 'goalshq_strategies', [
                {
                    name: 'color',
                    definition: { type: DataTypes.STRING(50), allowNull: true },
                },
                {
                    name: 'metrics_editable',
                    definition: {
                        type: DataTypes.BOOLEAN,
                        allowNull: false,
                        defaultValue: true,
                    },
                },
            ]);
            await safeChangeColumn(
                queryInterface,
                'goalshq_strategies',
                'goal_id',
                {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                }
            );
            for (const c of [
                'kind',
                'progress_mode',
                'weight_by_priority',
                'manual_percent',
                'importance',
                'horizon_label',
                'start_date',
                'target_date',
            ]) {
                await safeRemoveColumn(queryInterface, 'goalshq_strategies', c);
            }
            return;
        }
        await rebuild(
            queryInterface,
            NEW_STRATEGIES_DDL,
            'id, uid, goal_id, user_id, name, description, status, cached_percent, cached_health, cached_computed_at, sort_order, created_at, updated_at'
        );
    },

    async down(queryInterface) {
        if (queryInterface.sequelize.getDialect() !== 'sqlite') return;
        await rebuild(
            queryInterface,
            OLD_STRATEGIES_DDL,
            'id, uid, goal_id, user_id, name, description, status, cached_percent, cached_health, cached_computed_at, sort_order, created_at, updated_at'
        );
    },
};
