/**
 * Rollup performance budget. The engine must use batched aggregate queries, not
 * per-entity loops. Target from the plan: a user with ~20 goals / ~60 strategies
 * / ~200 projects / ~5 000 tasks recomputes in well under the ceiling below.
 *
 * The assertion is generous (CI machines vary) — its real job is to fail loudly
 * if someone reintroduces an N+1.
 */

const { sequelize, Goal, Project, Task } = require('../../../models');
require('../../../modules/goalshq/models');
const rollup = require('../../../modules/goalshq/operations/rollup');
const repo = require('../../../modules/goalshq/repository');
const { createTestUser } = require('../../helpers/testUtils');

const CEILING_MS = 4000;

describe('goalshq/rollup performance', () => {
    jest.setTimeout(60000);

    it('recomputes a large goal within the budget with bounded query count', async () => {
        const user = await createTestUser({ email: 'perf@example.com' });

        const goal = await Goal.create({
            user_id: user.id,
            title: 'Big',
            target_date: '2027-05-18',
            status: 'active',
        });

        // 30 projects on the goal, 5 strategies each linking 6 projects,
        // ~40 tasks per project (~1200 tasks) — scaled down from the plan target
        // so the suite stays fast while still exercising the batch paths.
        const projects = await Project.bulkCreate(
            Array.from({ length: 30 }, (_, i) => ({
                user_id: user.id,
                name: `P${i}`,
                goal_id: goal.id,
                status: 'in_progress',
            }))
        );

        const tasks = [];
        for (const p of projects) {
            for (let i = 0; i < 40; i += 1) {
                tasks.push({
                    user_id: user.id,
                    name: `t${p.id}-${i}`,
                    project_id: p.id,
                    status:
                        i % 2 === 0
                            ? Task.STATUS.DONE
                            : Task.STATUS.NOT_STARTED,
                });
            }
        }
        await Task.bulkCreate(tasks);

        for (let s = 0; s < 5; s += 1) {
            // eslint-disable-next-line no-await-in-loop
            const strategy = await repo.createStrategy({
                goal_id: goal.id,
                user_id: user.id,
                name: `S${s}`,
                kind: 'primary',
                status: 'active',
                importance: 3,
                progress_mode: 'rollup_projects',
                weight_by_priority: false,
                sort_order: s,
            });
            for (let k = 0; k < 6; k += 1) {
                // eslint-disable-next-line no-await-in-loop
                await repo.linkProjectToStrategy(
                    strategy.id,
                    projects[s * 6 + k].id,
                    user.id
                );
            }
        }

        let queryCount = 0;
        const original = sequelize.query.bind(sequelize);
        sequelize.query = (...args) => {
            queryCount += 1;
            return original(...args);
        };

        const start = Date.now();
        try {
            await rollup.recomputeGoal(goal.id, { source: 'manual' });
        } finally {
            sequelize.query = original;
        }
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(CEILING_MS);
        // No N+1: a handful of aggregate queries + per-strategy/-snapshot writes,
        // not one-per-task or one-per-project.
        expect(queryCount).toBeLessThan(120);
    });
});
