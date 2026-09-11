'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

/**
 * goalshq_milestone_projects — a milestone can auto-achieve from every task in a
 * whole project (expanded live at rollup time), alongside the fixed task list in
 * goalshq_milestone_tasks. No DB-level FK — consistent with the rest of goalshq;
 * dangling rows are swept by rollup.gcOrphans().
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'goalshq_milestone_projects', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            milestone_id: { type: Sequelize.INTEGER, allowNull: false },
            project_id: { type: Sequelize.INTEGER, allowNull: false },
            user_id: { type: Sequelize.INTEGER, allowNull: false },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });
        await safeAddIndex(
            queryInterface,
            'goalshq_milestone_projects',
            ['milestone_id', 'project_id'],
            { unique: true, name: 'goalshq_milestone_projects_uidx' }
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('goalshq_milestone_projects');
    },
};
