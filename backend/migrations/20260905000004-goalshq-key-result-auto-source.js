'use strict';

const {
    safeAddColumns,
    safeRemoveColumn,
} = require('../utils/migration-utils');

/**
 * Part of Phase F (KR current_value automation hooks — see
 * docs/goalshq/adr/0002-first-class-integration.md). 'tasks_done_count'
 * causes the rollup engine to auto-set current_value to the count of done
 * tasks in the KR's parent scope on every recompute, instead of requiring
 * manual upkeep.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeAddColumns(queryInterface, 'goalshq_key_results', [
            {
                name: 'auto_source',
                definition: {
                    type: Sequelize.ENUM('manual', 'tasks_done_count'),
                    allowNull: false,
                    defaultValue: 'manual',
                },
            },
        ]);
    },

    async down(queryInterface) {
        await safeRemoveColumn(
            queryInterface,
            'goalshq_key_results',
            'auto_source'
        );
    },
};
