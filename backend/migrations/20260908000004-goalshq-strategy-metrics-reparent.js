'use strict';

/**
 * Data migration (runs after the Phase-1 schema changes).
 *
 * Strategy is no longer a measured tier, so:
 *  - strategy-parented Key Results / Milestones move to the strategy's GOAL
 *    (when it has one and no same-named row already exists there); otherwise
 *    they stay on the strategy as display-only context.
 *  - stale strategy progress snapshots (the old weighted rollup) are cleared —
 *    the next recompute repopulates them as the grouping-summary average.
 *  - `metrics_enabled` is switched on for any goal/project that already has a
 *    Key Result or Milestone, so the reparented metrics stay visible.
 *
 * Irreversible in practice (down() is a no-op) — the reparenting is safe to
 * leave in place even if the code is rolled back.
 */
module.exports = {
    async up(queryInterface) {
        const q = queryInterface.sequelize;

        for (const table of ['goalshq_key_results', 'goalshq_milestones']) {
            const nameCol = table === 'goalshq_milestones' ? 'title' : 'name';
            // reparent to the goal when it won't collide with an existing row
            await q.query(`
                UPDATE ${table}
                   SET parent_type = 'goal',
                       parent_id = (
                           SELECT s.goal_id FROM goalshq_strategies s
                            WHERE s.id = ${table}.parent_id
                       )
                 WHERE parent_type = 'strategy'
                   AND EXISTS (
                       SELECT 1 FROM goalshq_strategies s
                        WHERE s.id = ${table}.parent_id AND s.goal_id IS NOT NULL
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM ${table} g
                        WHERE g.parent_type = 'goal'
                          AND g.parent_id = (
                              SELECT s.goal_id FROM goalshq_strategies s
                               WHERE s.id = ${table}.parent_id
                          )
                          AND g.${nameCol} = ${table}.${nameCol}
                   )
            `);
        }

        await q.query(
            `DELETE FROM goalshq_progress_snapshots WHERE parent_type = 'strategy'`
        );

        await q.query(`
            UPDATE goalshq_goal_settings SET metrics_enabled = 1
             WHERE goal_id IN (
                 SELECT parent_id FROM goalshq_key_results WHERE parent_type = 'goal'
                 UNION
                 SELECT parent_id FROM goalshq_milestones WHERE parent_type = 'goal'
             )
        `);
        await q.query(`
            UPDATE goalshq_project_settings SET metrics_enabled = 1
             WHERE project_id IN (
                 SELECT parent_id FROM goalshq_key_results WHERE parent_type = 'project'
                 UNION
                 SELECT parent_id FROM goalshq_milestones WHERE parent_type = 'project'
             )
        `);
    },

    async down() {
        // No-op: reparented metrics stay put; snapshots repopulate on recompute.
    },
};
