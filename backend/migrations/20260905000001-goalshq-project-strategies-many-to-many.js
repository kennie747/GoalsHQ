'use strict';

/**
 * Part of Phase A (backend de-isolation) — see docs/goalshq/adr/0002-first-class-integration.md.
 *
 * goalshq_project_strategies previously enforced "one strategy per project" via
 * a UNIQUE constraint on project_id alone (declared inline on the column, which
 * SQLite backs with an autoindex that cannot be dropped in place). This rebuilds
 * the table without that constraint and replaces it with a composite unique
 * index on (strategy_id, project_id), so a project can now be linked to more
 * than one strategy while still preventing duplicate links of the same pair.
 *
 * Existing rows are already 1:1 by construction (the old constraint enforced
 * it), so this is a pure schema change — no data transformation needed. The
 * up() migration still asserts zero duplicate (strategy_id, project_id) pairs
 * before proceeding, as a safety net.
 */

const TABLE = 'goalshq_project_strategies';

module.exports = {
    async up(queryInterface, Sequelize) {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;

        const [dupes] = await queryInterface.sequelize.query(
            `SELECT strategy_id, project_id, COUNT(*) as c FROM ${TABLE} GROUP BY strategy_id, project_id HAVING c > 1`
        );
        if (dupes.length > 0) {
            throw new Error(
                `Refusing to migrate ${TABLE}: found ${dupes.length} duplicate (strategy_id, project_id) pair(s). Resolve manually before re-running.`
            );
        }

        await queryInterface.sequelize.query('PRAGMA foreign_keys = OFF;');
        try {
            await queryInterface.sequelize.query(
                `DROP TABLE IF EXISTS ${TABLE}_new;`
            );

            await queryInterface.sequelize.query(`
                CREATE TABLE ${TABLE}_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    strategy_id INTEGER NOT NULL REFERENCES goalshq_strategies (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    weight FLOAT NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await queryInterface.sequelize.query(`
                INSERT INTO ${TABLE}_new (id, strategy_id, project_id, user_id, weight, created_at, updated_at)
                SELECT id, strategy_id, project_id, user_id, weight, created_at, updated_at FROM ${TABLE};
            `);

            await queryInterface.sequelize.query(`DROP TABLE ${TABLE};`);
            await queryInterface.sequelize.query(
                `ALTER TABLE ${TABLE}_new RENAME TO ${TABLE};`
            );
        } finally {
            await queryInterface.sequelize.query('PRAGMA foreign_keys = ON;');
        }

        await queryInterface.addIndex(TABLE, ['strategy_id'], {
            name: 'goalshq_project_strategies_strategy_id_idx',
        });
        await queryInterface.addIndex(TABLE, ['user_id'], {
            name: 'goalshq_project_strategies_user_id_idx',
        });
        await queryInterface.addIndex(TABLE, ['project_id'], {
            name: 'goalshq_project_strategies_project_id_idx',
        });
        await queryInterface.addIndex(TABLE, ['strategy_id', 'project_id'], {
            name: 'goalshq_project_strategies_strategy_project_uidx',
            unique: true,
        });
    },

    async down(queryInterface, Sequelize) {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;

        const [dupes] = await queryInterface.sequelize.query(
            `SELECT project_id, COUNT(*) as c FROM ${TABLE} GROUP BY project_id HAVING c > 1`
        );
        if (dupes.length > 0) {
            throw new Error(
                `Cannot revert ${TABLE} to one-strategy-per-project: ${dupes.length} project(s) are now linked to more than one strategy. Unlink them first.`
            );
        }

        await queryInterface.sequelize.query('PRAGMA foreign_keys = OFF;');
        try {
            await queryInterface.sequelize.query(
                `DROP TABLE IF EXISTS ${TABLE}_new;`
            );

            await queryInterface.sequelize.query(`
                CREATE TABLE ${TABLE}_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    strategy_id INTEGER NOT NULL REFERENCES goalshq_strategies (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    project_id INTEGER NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
                    weight FLOAT NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);

            await queryInterface.sequelize.query(`
                INSERT INTO ${TABLE}_new (id, strategy_id, project_id, user_id, weight, created_at, updated_at)
                SELECT id, strategy_id, project_id, user_id, weight, created_at, updated_at FROM ${TABLE};
            `);

            await queryInterface.sequelize.query(`DROP TABLE ${TABLE};`);
            await queryInterface.sequelize.query(
                `ALTER TABLE ${TABLE}_new RENAME TO ${TABLE};`
            );
        } finally {
            await queryInterface.sequelize.query('PRAGMA foreign_keys = ON;');
        }

        await queryInterface.addIndex(TABLE, ['strategy_id'], {
            name: 'goalshq_project_strategies_strategy_id_idx',
        });
        await queryInterface.addIndex(TABLE, ['user_id'], {
            name: 'goalshq_project_strategies_user_id_idx',
        });
    },
};
