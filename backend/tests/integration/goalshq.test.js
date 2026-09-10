const request = require('supertest');
const app = require('../../app');
const {
    Goal,
    Project,
    Task,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('../../models');
const rollup = require('../../modules/goalshq/operations/rollup');
const { createTestUser } = require('../helpers/testUtils');

async function clearGoalshq() {
    await Promise.all([
        GoalshqStrategy.destroy({ truncate: true }),
        GoalshqProjectStrategy.destroy({ truncate: true }),
        GoalshqGoalSettings.destroy({ truncate: true }),
        GoalshqProjectSettings.destroy({ truncate: true }),
        GoalshqKeyResult.destroy({ truncate: true }),
        GoalshqMilestone.destroy({ truncate: true }),
        GoalshqProgressSnapshot.destroy({ truncate: true }),
    ]);
}

describe('GoalsHQ routes (Strategy = grouping, execution/outcome split)', () => {
    let user;
    let agent;

    beforeEach(async () => {
        await clearGoalshq();
        user = await createTestUser({ email: 'goalshq@example.com' });
        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'goalshq@example.com',
            password: 'password123',
        });
    });

    async function makeGoal(overrides = {}) {
        return Goal.create({
            user_id: user.id,
            title: '$1M profit',
            target_date: '2027-05-18',
            status: 'active',
            ...overrides,
        });
    }

    async function makeProject(name, goalId) {
        return Project.create({
            user_id: user.id,
            name,
            goal_id: goalId || null,
            status: 'in_progress',
        });
    }

    async function makeTasks(projectId, total, done, goalId) {
        const rows = [];
        for (let i = 0; i < total; i += 1) {
            rows.push({
                user_id: user.id,
                name: `t${i}`,
                project_id: projectId || null,
                goal_id: goalId || null,
                status: i < done ? Task.STATUS.DONE : Task.STATUS.NOT_STARTED,
                completed_at: i < done ? new Date() : null,
            });
        }
        return Task.bulkCreate(rows);
    }

    /* ------------------------------------------------------------- enablement */

    it('reports GoalsHQ enablement via features.goalshq_enabled', async () => {
        const res = await agent.get('/api/current_user');
        expect(res.status).toBe(200);
        expect(res.body.user.features.goalshq_enabled).toBe(true);
    });

    /* --------------------------------------------------------- execution % */

    describe('execution rollup (task -> project -> goal)', () => {
        it('goal execution = task-weighted mean of its projects + direct tasks', async () => {
            const goal = await makeGoal();
            const pA = await makeProject('A', goal.id);
            const pB = await makeProject('B', goal.id);
            await makeTasks(pA.id, 4, 2); // 50%, weight 4
            await makeTasks(pB.id, 2, 0); // 0%,  weight 2
            await makeTasks(null, 2, 2, goal.id); // direct 100%, weight 2

            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.status).toBe(200);
            // (50*4 + 0*2 + 100*2) / 8 = 50
            expect(res.body.goal.execution_percent).toBe(50);
            expect(res.body.goal.outcome_percent).toBeNull();
        });

        it('counts subtasks alongside top-level tasks', async () => {
            const goal = await makeGoal();
            const p = await makeProject('P', goal.id);
            const [parent] = await makeTasks(p.id, 1, 1);
            await Task.create({
                user_id: user.id,
                name: 'sub',
                project_id: p.id,
                parent_task_id: parent.id,
                status: Task.STATUS.NOT_STARTED,
            });
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.execution_percent).toBe(50); // 1 of 2
        });

        it('manual_percent overrides the project execution number', async () => {
            const goal = await makeGoal();
            const p = await makeProject('P', goal.id);
            await makeTasks(p.id, 4, 1); // would be 25%
            await agent
                .patch(`/api/goalshq/projects/${p.uid}/settings`)
                .send({ manual_percent: 80 });
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.execution_percent).toBe(80);
        });
    });

    /* ----------------------------------------------------------- outcome % */

    describe('outcome layer (opt-in via metrics_enabled)', () => {
        it('is null until metrics are enabled, then driven by key results', async () => {
            const goal = await makeGoal();
            await agent
                .post(`/api/goalshq/goal/${goal.uid}/key-results`)
                .send({ name: 'Revenue', target_value: 10, current_value: 4 });

            let res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.outcome_percent).toBeNull();

            await agent
                .patch(`/api/goalshq/goals/${goal.uid}/settings`)
                .send({ metrics_enabled: true });

            res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.settings.metrics_enabled).toBe(true);
            expect(res.body.goal.outcome_percent).toBe(40); // 4/10
        });

        it('milestones contribute achieved/total to the outcome number', async () => {
            const goal = await makeGoal();
            await agent
                .patch(`/api/goalshq/goals/${goal.uid}/settings`)
                .send({ metrics_enabled: true });
            for (const status of ['achieved', 'pending']) {
                // eslint-disable-next-line no-await-in-loop
                await agent
                    .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                    .send({ title: `m-${status}`, status });
            }
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.outcome_percent).toBe(50);
        });

        it('execution % is unaffected by the outcome layer', async () => {
            const goal = await makeGoal();
            const p = await makeProject('P', goal.id);
            await makeTasks(p.id, 4, 3); // 75%
            await agent
                .patch(`/api/goalshq/goals/${goal.uid}/settings`)
                .send({ metrics_enabled: true });
            await agent
                .post(`/api/goalshq/goal/${goal.uid}/key-results`)
                .send({ name: 'KR', target_value: 100, current_value: 5 });
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.execution_percent).toBe(75);
            expect(res.body.goal.outcome_percent).toBe(5);
        });
    });

    /* ----------------------------------------------------- strategy = grouping */

    describe('strategy as a grouping bucket', () => {
        it('summary = unweighted mean of linked projects, and does NOT change the goal number', async () => {
            const goal = await makeGoal();
            const pA = await makeProject('A', goal.id);
            const pB = await makeProject('B', goal.id);
            await makeTasks(pA.id, 4, 4); // 100%
            await makeTasks(pB.id, 4, 0); // 0%

            const goalBefore = await agent.get(
                `/api/goalshq/goals/${goal.uid}`
            );
            const execBefore = goalBefore.body.goal.execution_percent;

            const created = await agent.post('/api/goalshq/strategies').send({
                name: 'Real Estate',
                goal_uid: goal.uid,
                project_uids: [pA.uid, pB.uid],
            });
            expect(created.status).toBe(201);

            const strat = await agent.get(
                `/api/goalshq/strategies/${created.body.strategy.uid}`
            );
            // plain mean of 100 and 0
            expect(strat.body.strategy.summary.percent).toBe(50);
            expect(strat.body.strategy.project_counts.total).toBe(2);

            const goalAfter = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(goalAfter.body.goal.execution_percent).toBe(execBefore);
        });

        it('can be created without a goal and later attached / detached', async () => {
            const created = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'Content Engine', color: '#2f9e6b' });
            expect(created.status).toBe(201);
            const uid = created.body.strategy.uid;
            expect(created.body.strategy.goal).toBeNull();
            expect(created.body.strategy.color).toBe('#2f9e6b');

            const goal = await makeGoal();
            let res = await agent
                .patch(`/api/goalshq/strategies/${uid}`)
                .send({ goal_uid: goal.uid });
            expect(res.body.strategy.goal.uid).toBe(goal.uid);

            res = await agent
                .patch(`/api/goalshq/strategies/${uid}`)
                .send({ goal_uid: null });
            expect(res.body.strategy.goal).toBeNull();
        });

        it('GET /api/goalshq/strategies lists goal-less strategies too', async () => {
            await agent.post('/api/goalshq/strategies').send({ name: 'Loose' });
            const res = await agent.get('/api/goalshq/strategies');
            expect(res.status).toBe(200);
            expect(res.body.strategies.map((s) => s.name)).toContain('Loose');
        });

        it('PUT .../projects replaces the project set (many-to-many)', async () => {
            const goal = await makeGoal();
            const p1 = await makeProject('p1', goal.id);
            const p2 = await makeProject('p2', goal.id);
            const p3 = await makeProject('p3', goal.id);
            const created = await agent.post('/api/goalshq/strategies').send({
                name: 'S',
                goal_uid: goal.uid,
                project_uids: [p1.uid, p2.uid],
            });
            const uid = created.body.strategy.uid;

            const res = await agent
                .put(`/api/goalshq/strategies/${uid}/projects`)
                .send({ project_uids: [p2.uid, p3.uid] });
            expect(res.status).toBe(200);
            expect(res.body.strategy.project_counts.total).toBe(2);
            const strat = await GoalshqStrategy.findOne({ where: { uid } });
            const links = await GoalshqProjectStrategy.findAll({
                where: { strategy_id: strat.id },
            });
            expect(links.map((l) => l.project_id).sort()).toEqual(
                [p2.id, p3.id].sort()
            );
        });

        it('a project can serve multiple strategies at once', async () => {
            const goal = await makeGoal();
            const project = await makeProject('shared', goal.id);
            const s1 = (
                await agent
                    .post('/api/goalshq/strategies')
                    .send({ name: 's1', goal_uid: goal.uid })
            ).body.strategy.uid;
            const s2 = (
                await agent
                    .post('/api/goalshq/strategies')
                    .send({ name: 's2', goal_uid: goal.uid })
            ).body.strategy.uid;
            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: project.uid });
            await agent
                .post(`/api/goalshq/strategies/${s2}/projects`)
                .send({ project_uid: project.uid });
            const links = await GoalshqProjectStrategy.findAll({
                where: { project_id: project.id },
            });
            expect(links).toHaveLength(2);
        });

        it('project side: PUT /projects/:uid/strategies sets the strategy set', async () => {
            const goal = await makeGoal();
            const project = await makeProject('p', goal.id);
            const s1 = (
                await agent
                    .post('/api/goalshq/strategies')
                    .send({ name: 's1', goal_uid: goal.uid })
            ).body.strategy.uid;
            const res = await agent
                .put(`/api/goalshq/projects/${project.uid}/strategies`)
                .send({ strategy_uids: [s1] });
            expect(res.status).toBe(200);
            const links = await GoalshqProjectStrategy.findAll({
                where: { project_id: project.id },
            });
            expect(links).toHaveLength(1);
        });

        it('deleting a strategy leaves its linked projects and the goal number intact', async () => {
            const goal = await makeGoal();
            const p = await makeProject('p', goal.id);
            await makeTasks(p.id, 2, 1);
            const created = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'S', goal_uid: goal.uid, project_uids: [p.uid] });
            await agent.delete(
                `/api/goalshq/strategies/${created.body.strategy.uid}`
            );
            expect(await Project.findByPk(p.id)).not.toBeNull();
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.execution_percent).toBe(50);
        });
    });

    /* ------------------------------------------------------- KR auto-source */

    describe('KR auto_source: tasks_done_count', () => {
        it('auto-populates a project KR from that project’s done-task count', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            await makeTasks(project.id, 5, 3);
            const created = await agent
                .post(`/api/goalshq/project/${project.uid}/key-results`)
                .send({
                    name: 'Tasks done',
                    target_value: 5,
                    auto_source: 'tasks_done_count',
                });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            const kr = await GoalshqKeyResult.findOne({
                where: { uid: created.body.key_result.uid },
            });
            expect(kr.current_value).toBe(3);
        });

        it('a task-parented KR never feeds any rollup', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            const [task] = await makeTasks(project.id, 2, 0);
            await agent.post(`/api/goalshq/task/${task.uid}/key-results`).send({
                name: 'quota',
                target_value: 20,
                current_value: 20,
                auto_source: 'tasks_done_count',
            });
            const res = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(res.body.goal.execution_percent).toBe(0);
        });
    });

    /* ------------------------------------------------- milestone expand */

    describe('milestone "Expand into tasks"', () => {
        it('creates a goal-linked task from a goal milestone', async () => {
            const goal = await makeGoal();
            const created = await agent
                .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                .send({ title: 'Ship v1', target_date: '2027-01-01' });
            const res = await agent.post(
                `/api/goalshq/milestones/${created.body.milestone.uid}/expand`
            );
            expect(res.status).toBe(201);
            const task = await Task.findOne({
                where: { uid: res.body.task.uid },
            });
            expect(task.goal_id).toBe(goal.id);
        });

        it('a strategy milestone with no goal still expands (goal-less task)', async () => {
            const created = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'S' });
            const ms = await agent
                .post(
                    `/api/goalshq/strategy/${created.body.strategy.uid}/milestones`
                )
                .send({ title: 'Pilot' });
            const res = await agent.post(
                `/api/goalshq/milestones/${ms.body.milestone.uid}/expand`
            );
            expect(res.status).toBe(201);
        });

        it('is idempotent — a second expand returns the same task, creates no duplicate', async () => {
            const goal = await makeGoal();
            const created = await agent
                .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                .send({ title: 'Ship v1' });
            const msUid = created.body.milestone.uid;

            const first = await agent.post(
                `/api/goalshq/milestones/${msUid}/expand`
            );
            const second = await agent.post(
                `/api/goalshq/milestones/${msUid}/expand`
            );

            expect(second.body.task.uid).toBe(first.body.task.uid);
            expect(second.body.task.already_existed).toBe(true);
            expect(await Task.count({ where: { name: 'Ship v1' } })).toBe(1);

            const detail = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            const m = detail.body.goal.milestones.find((x) => x.uid === msUid);
            expect(m.expanded_task_uid).toBe(first.body.task.uid);
            expect(m.task_uids).toContain(first.body.task.uid);
        });

        it('deleting the expanded task reopens the expand action', async () => {
            const goal = await makeGoal();
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                goal_id: goal.id,
                status: 'in_progress',
            });
            const created = await agent
                .post(`/api/goalshq/project/${project.uid}/milestones`)
                .send({ title: 'Do the thing' });
            const msUid = created.body.milestone.uid;
            const exp = await agent.post(
                `/api/goalshq/milestones/${msUid}/expand`
            );

            await agent.delete(`/api/task/${exp.body.task.uid}`).expect(200);

            const m = await GoalshqMilestone.findOne({ where: { uid: msUid } });
            expect(m.expanded_task_id).toBeNull();
            const detail = await agent.get(
                `/api/goalshq/projects/${project.uid}`
            );
            const dm = detail.body.project.milestones.find(
                (x) => x.uid === msUid
            );
            expect(dm.expanded_task_uid).toBeNull();
            expect(dm.task_uids).toEqual([]);

            // A fresh expand now creates a new task again.
            const again = await agent
                .post(`/api/goalshq/milestones/${msUid}/expand`)
                .expect(201);
            expect(again.body.task.already_existed).toBe(false);
        });

        it('completing the expanded task auto-achieves the milestone (its only task)', async () => {
            const goal = await makeGoal();
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                goal_id: goal.id,
                status: 'in_progress',
            });
            const created = await agent
                .post(`/api/goalshq/project/${project.uid}/milestones`)
                .send({ title: 'One and done' });
            const msUid = created.body.milestone.uid;
            const exp = await agent.post(
                `/api/goalshq/milestones/${msUid}/expand`
            );

            await agent
                .patch(`/api/task/${exp.body.task.uid}`)
                .send({ status: 'done' })
                .expect(200);

            const m = await GoalshqMilestone.findOne({ where: { uid: msUid } });
            expect(m.status).toBe('achieved');
            expect(m.auto_achieved).toBe(true);
        });
    });

    /* --------------------------------------------------------- auth scoping */

    describe('authorization scoping', () => {
        it('404s on another user’s goal', async () => {
            const other = await createTestUser({ email: 'x@example.com' });
            const g = await Goal.create({
                user_id: other.id,
                title: 'theirs',
                status: 'active',
            });
            const res = await agent.get(`/api/goalshq/goals/${g.uid}`);
            expect(res.status).toBe(404);
        });

        it('requires auth', async () => {
            const res = await request(app).get('/api/goalshq/goals');
            expect(res.status).toBe(401);
        });
    });

    /* --------------------------------------------------------- validation */

    describe('validation', () => {
        it('rejects a blank strategy name', async () => {
            const res = await agent
                .post('/api/goalshq/strategies')
                .send({ name: '   ' });
            expect(res.status).toBe(400);
        });

        it('rejects a non-hex colour', async () => {
            const res = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'S', color: 'reddish' });
            expect(res.status).toBe(400);
        });

        it('rejects an unknown status', async () => {
            const res = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'S', status: 'nope' });
            expect(res.status).toBe(400);
        });
    });

    /* ------------------------------------------------------------- gcOrphans */

    describe('gcOrphans', () => {
        it('removes project-parented settings/key-results once the project is gone', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            await agent
                .post(`/api/goalshq/project/${project.uid}/key-results`)
                .send({ name: 'KR', target_value: 10 });
            await agent
                .patch(`/api/goalshq/projects/${project.uid}/settings`)
                .send({ metrics_enabled: true });
            await Project.destroy({ where: { id: project.id } });

            await rollup.gcOrphans();

            expect(
                await GoalshqProjectSettings.count({
                    where: { project_id: project.id },
                })
            ).toBe(0);
            expect(
                await GoalshqKeyResult.count({
                    where: { parent_type: 'project', parent_id: project.id },
                })
            ).toBe(0);
        });

        it('keeps a goal-less strategy (it is valid, not an orphan)', async () => {
            const created = await agent
                .post('/api/goalshq/strategies')
                .send({ name: 'Loose' });
            await rollup.gcOrphans();
            expect(
                await GoalshqStrategy.findOne({
                    where: { uid: created.body.strategy.uid },
                })
            ).not.toBeNull();
        });
    });
});
