const request = require('supertest');
const app = require('../../app');
const { Goal, Project, Task } = require('../../models');
const {
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
} = require('../../modules/goalshq/models');
const { createTestUser } = require('../helpers/testUtils');

async function clearGoalshq() {
    await Promise.all([
        GoalshqStrategy.destroy({ truncate: true }),
        GoalshqProjectStrategy.destroy({ truncate: true }),
        GoalshqGoalSettings.destroy({ truncate: true }),
        GoalshqKeyResult.destroy({ truncate: true }),
        GoalshqMilestone.destroy({ truncate: true }),
        GoalshqProgressSnapshot.destroy({ truncate: true }),
    ]);
}

describe('GoalsHQ routes', () => {
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

    describe('GET /api/goalshq/config', () => {
        it('reports enabled', async () => {
            const res = await agent.get('/api/goalshq/config');
            expect(res.status).toBe(200);
            expect(res.body.enabled).toBe(true);
        });
    });

    describe('rollup through the full chain', () => {
        it('computes strategy, direct bucket and goal percent', async () => {
            const goal = await makeGoal();
            const pA = await makeProject('A', goal.id);
            const pB = await makeProject('B', goal.id);
            const pC = await makeProject('C', goal.id); // stays direct
            await makeTasks(pA.id, 4, 2);
            await makeTasks(pB.id, 2, 0);
            await makeTasks(pC.id, 3, 3);

            const created = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: 'AI Agency', kind: 'primary', importance: 5 });
            expect(created.status).toBe(201);
            const strategyUid = created.body.strategy.uid;

            await agent
                .post(`/api/goalshq/strategies/${strategyUid}/projects`)
                .send({ project_uid: pA.uid });
            await agent
                .post(`/api/goalshq/strategies/${strategyUid}/projects`)
                .send({ project_uid: pB.uid });

            const recompute = await agent.post(
                `/api/goalshq/goals/${goal.uid}/recompute`
            );
            expect(recompute.status).toBe(200);

            const detail = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(detail.status).toBe(200);
            const body = detail.body.goal;

            const strategy = body.strategies.find((s) => s.uid === strategyUid);
            // A: 2/4, B: 0/2 -> rollup_projects weighted by task count = (50*4 + 0*2)/6 ≈ 33.3
            expect(strategy.percent).toBeGreaterThan(30);
            expect(strategy.percent).toBeLessThan(37);

            // C stays a direct project at 100%
            const directC = body.direct_projects.find((p) => p.uid === pC.uid);
            expect(directC.percent).toBe(100);

            expect(body.percent).toBeGreaterThan(0);
            expect(['on_track', 'at_risk', 'off_track']).toContain(body.health);
            expect(body.trend.length).toBeGreaterThanOrEqual(1);
        });

        it('metric mode uses key results', async () => {
            const goal = await makeGoal();
            const created = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: 'EdTech', progress_mode: 'metric' });
            const strategyUid = created.body.strategy.uid;

            await agent
                .post(`/api/goalshq/strategy/${strategyUid}/key-results`)
                .send({
                    name: 'MRR',
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 100,
                    current_value: 40,
                });

            await agent.post(
                `/api/goalshq/strategies/${strategyUid}/recompute`
            );
            const detail = await agent.get(
                `/api/goalshq/strategies/${strategyUid}`
            );
            expect(detail.body.strategy.percent).toBe(40);
        });

        it('milestones mode = achieved / total', async () => {
            const goal = await makeGoal();
            await agent
                .patch(`/api/goalshq/goals/${goal.uid}/settings`)
                .send({ progress_mode: 'milestones' });

            await agent
                .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                .send({ title: 'MVP' });
            await agent
                .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                .send({ title: 'Launch' });

            const goalDetail = await agent.get(
                `/api/goalshq/goals/${goal.uid}`
            );
            expect(goalDetail.body.goal.milestones.length).toBe(2);

            const mvp = await GoalshqMilestone.findOne({
                where: { title: 'MVP' },
            });
            await agent
                .patch(`/api/goalshq/milestones/${mvp.uid}`)
                .send({ status: 'achieved' });

            const recompute = await agent.post(
                `/api/goalshq/goals/${goal.uid}/recompute`
            );
            expect(recompute.body.goal.percent).toBe(50);
        });
    });

    describe('authorization scoping', () => {
        it('404s on another user’s goal', async () => {
            const other = await createTestUser({ email: 'other@example.com' });
            const otherGoal = await Goal.create({
                user_id: other.id,
                title: 'not yours',
                status: 'active',
            });
            const res = await agent.get(`/api/goalshq/goals/${otherGoal.uid}`);
            expect(res.status).toBe(404);
        });

        it('requires auth', async () => {
            const res = await request(app).get('/api/goalshq/goals');
            expect(res.status).toBe(401);
        });
    });

    describe('strategy lifecycle', () => {
        it('creates, updates, links, unlinks and deletes', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);

            const created = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: 'S1' });
            const uid = created.body.strategy.uid;

            const updated = await agent
                .patch(`/api/goalshq/strategies/${uid}`)
                .send({ importance: 4, status: 'paused' });
            expect(updated.body.strategy.importance).toBe(4);
            expect(updated.body.strategy.status).toBe('paused');

            const linked = await agent
                .post(`/api/goalshq/strategies/${uid}/projects`)
                .send({ project_uid: project.uid });
            expect(linked.body.strategy.projects).toHaveLength(1);

            const unlinked = await agent.delete(
                `/api/goalshq/strategies/${uid}/projects/${project.uid}`
            );
            expect(unlinked.body.strategy.projects).toHaveLength(0);

            const del = await agent.delete(`/api/goalshq/strategies/${uid}`);
            expect(del.status).toBe(204);

            const list = await agent.get(
                `/api/goalshq/goals/${goal.uid}/strategies`
            );
            expect(list.body.strategies).toHaveLength(0);
        });

        it('a project belongs to at most one strategy', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            const s1 = (
                await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S1' })
            ).body.strategy.uid;
            const s2 = (
                await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S2' })
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
            expect(links).toHaveLength(1);
        });
    });

    describe('validation', () => {
        it('rejects a blank strategy name', async () => {
            const goal = await makeGoal();
            const res = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: '   ' });
            expect(res.status).toBe(400);
        });

        it('rejects importance out of range', async () => {
            const goal = await makeGoal();
            const res = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: 'S', importance: 9 });
            expect(res.status).toBe(400);
        });
    });
});
