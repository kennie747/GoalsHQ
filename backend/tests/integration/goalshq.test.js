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

    describe('GET /api/current_user', () => {
        it('reports GoalsHQ enablement via features.goalshq_enabled', async () => {
            const res = await agent.get('/api/current_user');
            expect(res.status).toBe(200);
            expect(res.body.user.features.goalshq_enabled).toBe(true);
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

        it('counts subtasks alongside top-level tasks in the rollup', async () => {
            const goal = await makeGoal();
            const project = await makeProject('With subtasks', goal.id);
            // 1 top-level task, not done, with 3 subtasks (2 done) sharing its project_id
            const [parent] = await makeTasks(project.id, 1, 0);
            await Task.bulkCreate([
                {
                    user_id: user.id,
                    name: 'sub-1',
                    project_id: project.id,
                    parent_task_id: parent.id,
                    status: Task.STATUS.DONE,
                    completed_at: new Date(),
                },
                {
                    user_id: user.id,
                    name: 'sub-2',
                    project_id: project.id,
                    parent_task_id: parent.id,
                    status: Task.STATUS.DONE,
                    completed_at: new Date(),
                },
                {
                    user_id: user.id,
                    name: 'sub-3',
                    project_id: project.id,
                    parent_task_id: parent.id,
                    status: Task.STATUS.NOT_STARTED,
                },
            ]);

            const recompute = await agent.post(
                `/api/goalshq/goals/${goal.uid}/recompute`
            );
            expect(recompute.status).toBe(200);

            const detail = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            const directProject = detail.body.goal.direct_projects.find(
                (p) => p.uid === project.uid
            );
            // 1 not-done parent + 2 done subtasks + 1 not-done subtask = 2/4 = 50%
            // (would be 0/1 = 0% if subtasks were still invisible to the rollup)
            expect(directProject.percent).toBe(50);
        });

        it('a project in metric mode uses its own key results, and a strategy prefers that over the task percent', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            await makeTasks(project.id, 4, 0); // 0% by task completion

            const strategyCreated = await agent
                .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                .send({ name: 'S1' });
            const strategyUid = strategyCreated.body.strategy.uid;
            await agent
                .post(`/api/goalshq/strategies/${strategyUid}/projects`)
                .send({ project_uid: project.uid });

            await agent
                .patch(`/api/goalshq/projects/${project.uid}/settings`)
                .send({ progress_mode: 'metric' });
            await agent
                .post(`/api/goalshq/project/${project.uid}/key-results`)
                .send({
                    name: 'Signups',
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 10,
                    current_value: 7,
                });

            const projectDetail = await agent.get(
                `/api/goalshq/projects/${project.uid}`
            );
            // 7/10 signups = 70%, not 0% (the task-completion percent)
            expect(projectDetail.body.project.percent).toBe(70);

            const strategyDetail = await agent.get(
                `/api/goalshq/strategies/${strategyUid}`
            );
            // strategy's single linked project contributes its measured 70%,
            // not its 0% task-completion percent
            expect(strategyDetail.body.strategy.percent).toBe(70);
        });

        it('a task-level key result is informational only and does not affect any rollup', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            const [task] = await makeTasks(project.id, 1, 0);

            const created = await agent
                .post(`/api/goalshq/task/${task.uid}/key-results`)
                .send({
                    name: 'Outreaches sent',
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 20,
                    current_value: 12,
                });
            expect(created.status).toBe(201);
            expect(created.body.key_result.current_value).toBe(12);

            const detail = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            const directProject = detail.body.goal.direct_projects.find(
                (p) => p.uid === project.uid
            );
            // the task is still not-done -> project percent unaffected by the KR
            expect(directProject.percent).toBe(0);
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

        describe('milestone "Expand into tasks" (Phase F)', () => {
            it('creates a goal-linked task from a goal-parented milestone', async () => {
                const goal = await makeGoal();
                const created = await agent
                    .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                    .send({ title: 'Ship v1', target_date: '2027-01-01' });

                const res = await agent.post(
                    `/api/goalshq/milestones/${created.body.milestone.uid}/expand`
                );
                expect(res.status).toBe(201);
                expect(res.body.task.name).toBe('Ship v1');

                const task = await Task.findOne({
                    where: { uid: res.body.task.uid },
                });
                expect(task.goal_id).toBe(goal.id);
                expect(task.project_id).toBeNull();
            });

            it('creates a project-linked task from a project-parented milestone', async () => {
                const goal = await makeGoal();
                const project = await makeProject('P', goal.id);
                const created = await agent
                    .post(`/api/goalshq/project/${project.uid}/milestones`)
                    .send({ title: 'Beta release' });

                const res = await agent.post(
                    `/api/goalshq/milestones/${created.body.milestone.uid}/expand`
                );
                expect(res.status).toBe(201);

                const task = await Task.findOne({
                    where: { uid: res.body.task.uid },
                });
                expect(task.project_id).toBe(project.id);
            });

            it("creates a task linked to the strategy's own goal from a strategy-parented milestone", async () => {
                const goal = await makeGoal();
                const strategyCreated = await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S1' });
                const strategyUid = strategyCreated.body.strategy.uid;

                const created = await agent
                    .post(`/api/goalshq/strategy/${strategyUid}/milestones`)
                    .send({ title: 'Pilot done' });

                const res = await agent.post(
                    `/api/goalshq/milestones/${created.body.milestone.uid}/expand`
                );
                expect(res.status).toBe(201);

                const task = await Task.findOne({
                    where: { uid: res.body.task.uid },
                });
                expect(task.goal_id).toBe(goal.id);
            });

            it('404s expanding a milestone that does not belong to the current user', async () => {
                const otherUser = await createTestUser({
                    email: 'goalshq-other@example.com',
                });
                const otherGoal = await Goal.create({
                    user_id: otherUser.id,
                    title: 'Not mine',
                    status: 'active',
                });
                const otherAgent = request.agent(app);
                await otherAgent.post('/api/login').send({
                    email: 'goalshq-other@example.com',
                    password: 'password123',
                });
                const created = await otherAgent
                    .post(`/api/goalshq/goal/${otherGoal.uid}/milestones`)
                    .send({ title: "Someone else's milestone" });

                const res = await agent.post(
                    `/api/goalshq/milestones/${created.body.milestone.uid}/expand`
                );
                expect(res.status).toBe(404);
            });
        });

        describe('KR automation hooks (auto_source: tasks_done_count)', () => {
            it("auto-populates a project-level KR current_value from that project's done task count", async () => {
                const goal = await makeGoal();
                const project = await makeProject('P', goal.id);
                await makeTasks(project.id, 5, 3); // 3 done of 5

                await agent
                    .patch(`/api/goalshq/projects/${project.uid}/settings`)
                    .send({ progress_mode: 'metric' });
                const created = await agent
                    .post(`/api/goalshq/project/${project.uid}/key-results`)
                    .send({
                        name: 'Tasks shipped',
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 5,
                        current_value: 0,
                        auto_source: 'tasks_done_count',
                    });
                expect(created.status).toBe(201);
                expect(created.body.key_result.auto_source).toBe(
                    'tasks_done_count'
                );

                await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

                const projectDetail = await agent.get(
                    `/api/goalshq/projects/${project.uid}`
                );
                const kr = projectDetail.body.project.key_results.find(
                    (k) => k.uid === created.body.key_result.uid
                );
                expect(kr.current_value).toBe(3);
                // metric mode: 3/5 = 60%
                expect(projectDetail.body.project.percent).toBe(60);
            });

            it('auto-populates a strategy-level KR from the done task count across its linked projects only', async () => {
                const goal = await makeGoal();
                const linked = await makeProject('Linked', goal.id);
                const unlinked = await makeProject('Unlinked', goal.id); // stays direct
                await makeTasks(linked.id, 4, 3); // 3 done
                await makeTasks(unlinked.id, 4, 4); // would be 4 more if wrongly included

                const strategyCreated = await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S1', progress_mode: 'metric' });
                const strategyUid = strategyCreated.body.strategy.uid;
                await agent
                    .post(`/api/goalshq/strategies/${strategyUid}/projects`)
                    .send({ project_uid: linked.uid });

                const created = await agent
                    .post(`/api/goalshq/strategy/${strategyUid}/key-results`)
                    .send({
                        name: 'Tasks shipped',
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 3,
                        current_value: 0,
                        auto_source: 'tasks_done_count',
                    });

                await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

                const strategyDetail = await agent.get(
                    `/api/goalshq/strategies/${strategyUid}`
                );
                const kr = strategyDetail.body.strategy.key_results.find(
                    (k) => k.uid === created.body.key_result.uid
                );
                expect(kr.current_value).toBe(3);
            });

            it('auto-populates a goal-level KR from done tasks across every project plus direct goal tasks', async () => {
                const goal = await makeGoal();
                const project = await makeProject('P', goal.id);
                await makeTasks(project.id, 4, 2); // 2 done via project
                await makeTasks(null, 3, 1, goal.id); // 1 done direct-on-goal

                await agent
                    .patch(`/api/goalshq/goals/${goal.uid}/settings`)
                    .send({ progress_mode: 'metric' });
                const created = await agent
                    .post(`/api/goalshq/goal/${goal.uid}/key-results`)
                    .send({
                        name: 'Total tasks shipped',
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 3,
                        current_value: 0,
                        auto_source: 'tasks_done_count',
                    });

                const recompute = await agent.post(
                    `/api/goalshq/goals/${goal.uid}/recompute`
                );
                expect(recompute.body.goal.percent).toBe(100); // 3/3

                const goalDetail = await agent.get(
                    `/api/goalshq/goals/${goal.uid}`
                );
                const kr = goalDetail.body.goal.key_results.find(
                    (k) => k.uid === created.body.key_result.uid
                );
                expect(kr.current_value).toBe(3);
            });

            it('never touches a task-parented KR even when auto_source is set (informational only, per AF3)', async () => {
                const goal = await makeGoal();
                const project = await makeProject('P', goal.id);
                const [task] = await makeTasks(project.id, 1, 0);

                const created = await agent
                    .post(`/api/goalshq/task/${task.uid}/key-results`)
                    .send({
                        name: 'Outreaches sent',
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 20,
                        current_value: 12,
                        auto_source: 'tasks_done_count',
                    });
                expect(created.status).toBe(201);

                await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

                const kr = await GoalshqKeyResult.findOne({
                    where: { uid: created.body.key_result.uid },
                });
                expect(kr.current_value).toBe(12); // untouched
            });

            it('updating a KR to auto_source: manual stops further automatic updates', async () => {
                const goal = await makeGoal();
                const project = await makeProject('P', goal.id);
                await makeTasks(project.id, 5, 3);

                const created = await agent
                    .post(`/api/goalshq/project/${project.uid}/key-results`)
                    .send({
                        name: 'Tasks shipped',
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 5,
                        current_value: 0,
                        auto_source: 'tasks_done_count',
                    });
                await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

                await agent
                    .patch(
                        `/api/goalshq/key-results/${created.body.key_result.uid}`
                    )
                    .send({ auto_source: 'manual', current_value: 99 });

                // more tasks complete, but the KR is manual now
                await Task.update(
                    { status: Task.STATUS.DONE, completed_at: new Date() },
                    { where: { project_id: project.id } }
                );
                await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

                const kr = await GoalshqKeyResult.findOne({
                    where: { uid: created.body.key_result.uid },
                });
                expect(kr.current_value).toBe(99); // untouched by the recompute
            });
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

        it('the goals list exposes which projects (by uid) each strategy is linked to', async () => {
            const goal = await makeGoal();
            const projectA = await makeProject('A', goal.id);
            const projectB = await makeProject('B', goal.id);

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
                .send({ project_uid: projectA.uid });
            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: projectB.uid });
            // s2 is linked to projectA too, to confirm many-to-many attribution
            await agent
                .post(`/api/goalshq/strategies/${s2}/projects`)
                .send({ project_uid: projectA.uid });

            const list = await agent.get('/api/goalshq/goals');
            const goalSummary = list.body.goals.find((g) => g.uid === goal.uid);
            const strat1 = goalSummary.strategies.find((s) => s.uid === s1);
            const strat2 = goalSummary.strategies.find((s) => s.uid === s2);

            expect(strat1.project_uids.sort()).toEqual(
                [projectA.uid, projectB.uid].sort()
            );
            expect(strat2.project_uids).toEqual([projectA.uid]);

            expect(strat1.projects.map((p) => p.uid).sort()).toEqual(
                [projectA.uid, projectB.uid].sort()
            );
            expect(
                strat1.projects.find((p) => p.uid === projectA.uid).name
            ).toBe('A');
            expect(strat2.projects).toEqual([{ uid: projectA.uid, name: 'A' }]);
        });

        it('the goals list exposes projects_count and tasks_count, deduped across direct and strategy-linked projects', async () => {
            const goal = await makeGoal();
            const projectA = await makeProject('A', goal.id);
            const projectB = await makeProject('B', goal.id);
            // both projects are DIRECT (goal_id set) as well as strategy-linked below,
            // so projects_count must dedupe rather than double-count.
            await makeTasks(projectA.id, 3, 1);
            await makeTasks(projectB.id, 2, 0);
            await makeTasks(null, 1, 0, goal.id); // a task attached straight to the goal

            const s1 = (
                await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S1' })
            ).body.strategy.uid;
            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: projectA.uid });
            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: projectB.uid });

            const list = await agent.get('/api/goalshq/goals');
            const goalSummary = list.body.goals.find((g) => g.uid === goal.uid);

            expect(goalSummary.projects_count).toBe(2);
            expect(goalSummary.tasks_count).toBe(3 + 2 + 1);
        });

        it('a project can serve multiple strategies at once', async () => {
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
            expect(links).toHaveLength(2);
        });

        it('re-linking to the same strategy updates weight instead of duplicating', async () => {
            const goal = await makeGoal();
            const project = await makeProject('P', goal.id);
            const s1 = (
                await agent
                    .post(`/api/goalshq/goals/${goal.uid}/strategies`)
                    .send({ name: 'S1' })
            ).body.strategy.uid;

            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: project.uid, weight: 1 });
            await agent
                .post(`/api/goalshq/strategies/${s1}/projects`)
                .send({ project_uid: project.uid, weight: 2 });

            const links = await GoalshqProjectStrategy.findAll({
                where: { project_id: project.id },
            });
            expect(links).toHaveLength(1);
            expect(links[0].weight).toBe(2);
        });

        it('moveProjectLink detaches from one strategy and attaches to another', async () => {
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

            const move = await agent
                .patch(
                    `/api/goalshq/strategies/${s1}/projects/${project.uid}/move`
                )
                .send({ to_strategy_uid: s2 });
            expect(move.status).toBe(200);

            const links = await GoalshqProjectStrategy.findAll({
                where: { project_id: project.id },
            });
            expect(links).toHaveLength(1);
            expect(links[0].strategy_id).not.toBeNull();
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

    describe('gcOrphans', () => {
        it('removes project-parented settings/key-results once the project is gone', async () => {
            const goal = await makeGoal();
            const project = await makeProject('Doomed', goal.id);

            await agent
                .patch(`/api/goalshq/projects/${project.uid}/settings`)
                .send({ progress_mode: 'metric' });
            await agent
                .post(`/api/goalshq/project/${project.uid}/key-results`)
                .send({
                    name: 'X',
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 10,
                    current_value: 5,
                });

            // Bypass the app's own delete flow to simulate the project
            // vanishing out from under GoalsHQ (SQLite runs with
            // foreign_keys OFF, so a real delete wouldn't cascade either).
            await Project.destroy({ where: { id: project.id } });

            const removed = await rollup.gcOrphans();
            expect(removed).toBeGreaterThan(0);

            const settings = await GoalshqProjectSettings.findOne({
                where: { project_id: project.id },
            });
            expect(settings).toBeNull();
            const krs = await GoalshqKeyResult.findAll({
                where: { parent_type: 'project', parent_id: project.id },
            });
            expect(krs).toHaveLength(0);
        });
    });
});
