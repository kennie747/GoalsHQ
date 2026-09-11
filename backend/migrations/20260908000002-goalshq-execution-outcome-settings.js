'use strict';

const { safeAddColumns } = require('../utils/migration-utils');

/**
 * Goal & Project settings move from a single `progress_mode` selector to:
 *   - `metrics_enabled` (boolean) — opt in to the outcome (KR/milestone) layer
 *   - always-on execution % + optional outcome %, cached separately.
 *
 * The old `progress_mode` / `importance` / `weight_by_priority` columns are
 * left in place (unused, harmless) rather than risk a FK-carrying SQLite table
 * rebuild — the models no longer reference them.
 *
 * NOTE: on a brand-new database, `scripts/db-init.js` creates every table via
 * `sequelize.sync()` against the *current* models — which never declared
 * `progress_mode` / `cached_percent` / `cached_health` in the first place —
 * before this migration (and every other historical one) replays on top. The
 * backfill below is a no-op in that case (a freshly-synced table has no rows
 * to backfill anyway), so it is skipped rather than erroring on a column that
 * was never created. See https://github.com/kennie747/tududi/issues/3.
 */
const HEALTH = ['on_track', 'at_risk', 'off_track', 'no_data'];

async function upgrade(queryInterface, Sequelize, table) {
    await safeAddColumns(queryInterface, table, [
        {
            name: 'metrics_enabled',
            definition: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
        },
        {
            name: 'cached_execution_percent',
            definition: { type: Sequelize.FLOAT, allowNull: true },
        },
        {
            name: 'cached_execution_health',
            definition: { type: Sequelize.ENUM(...HEALTH), allowNull: true },
        },
        {
            name: 'cached_outcome_percent',
            definition: { type: Sequelize.FLOAT, allowNull: true },
        },
        {
            name: 'cached_outcome_health',
            definition: { type: Sequelize.ENUM(...HEALTH), allowNull: true },
        },
    ]);

    const columns = await queryInterface.describeTable(table);
    if (!columns.cached_percent) {
        console.log(
            `${table} has no legacy cached_percent column (fresh database) — skipping backfill`
        );
        return;
    }

    // Carry the old single cache forward as the execution cache, and switch
    // metrics on for goals/projects already in a metric-driven mode (Phase 7's
    // data migration also flips it on wherever KRs/milestones already exist).
    await queryInterface.sequelize.query(
        `UPDATE ${table}
            SET cached_execution_percent = cached_percent,
                cached_execution_health  = cached_health,
                metrics_enabled = CASE
                    WHEN progress_mode IN ('metric', 'milestones') THEN 1
                    ELSE 0 END`
    );
}

async function downgrade(queryInterface, table) {
    const { safeRemoveColumn } = require('../utils/migration-utils');
    for (const col of [
        'metrics_enabled',
        'cached_execution_percent',
        'cached_execution_health',
        'cached_outcome_percent',
        'cached_outcome_health',
    ]) {
        await safeRemoveColumn(queryInterface, table, col);
    }
}

module.exports = {
    async up(queryInterface, Sequelize) {
        await upgrade(queryInterface, Sequelize, 'goalshq_goal_settings');
        await upgrade(queryInterface, Sequelize, 'goalshq_project_settings');
    },
    async down(queryInterface) {
        await downgrade(queryInterface, 'goalshq_goal_settings');
        await downgrade(queryInterface, 'goalshq_project_settings');
    },
};
