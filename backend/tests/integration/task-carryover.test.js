const request = require('supertest');
const app = require('../../app');
const {
    sequelize,
    Task,
    Goal,
    Project,
    TaskCarryoverEvent,
    GoalshqStrategy,
    GoalshqProjectStrategy,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const {
    classifyOverdueTasks,
} = require('../../modules/tasks/carryover/service');

function daysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}

/**
 * Hard-deletes a task the same way production actually behaves: this app
 * runs SQLite with `PRAGMA foreign_keys = OFF` (confirmed against the real
 * dev.sqlite3), so a task_carryover_events row is never cascade-deleted with
 * its task. The Jest test harness (tests/helpers/setup.js) deliberately runs
 * with foreign_keys ON as a safety net for other tests, which would silently
 * cascade-delete the row here and make a "dangling event" scenario
 * impossible to construct — so this toggles it off for just this one
 * statement, matching the harness's own established toggle-and-restore
 * pattern, to accurately simulate what actually happens outside tests.
 */
async function forceDeleteTaskWithoutCascade(taskId) {
    await sequelize.query('PRAGMA foreign_keys = OFF');
    try {
        await Task.destroy({ where: { id: taskId }, force: true });
    } finally {
        await sequelize.query('PRAGMA foreign_keys = ON');
    }
}

describe('Task carryover (Phase D)', () => {
    let user, agent;

    beforeEach(async () => {
        user = await createTestUser({
            email: 'carryover@example.com',
            timezone: 'UTC',
        });
        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'carryover@example.com',
            password: 'password123',
        });
    });

    describe('classifyOverdueTasks', () => {
        it('classifies an unlinked, low-priority, long-overdue task as "drop"', async () => {
            await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });

            const result = await classifyOverdueTasks();
            expect(result.classified).toBe(1);

            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('drop');
            expect(event.new_due_date).toBeNull();
            expect(event.source).toBe('auto');
            expect(event.reviewed_at).toBeNull();
        });

        it('classifies a project-linked overdue task as "reschedule" with new_due_date = today', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            await Task.create({
                user_id: user.id,
                name: 'Linked task',
                project_id: project.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(2),
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('reschedule');
            expect(event.new_due_date).not.toBeNull();
        });

        it('classifies a task linked to an at_risk strategy as "resurface" (no due date proposed)', async () => {
            const goal = await Goal.create({
                user_id: user.id,
                title: 'Goal',
                horizon: 'season',
                status: 'active',
            });
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                goal_id: goal.id,
                status: 'in_progress',
            });
            const strategy = await GoalshqStrategy.create({
                goal_id: goal.id,
                user_id: user.id,
                name: 'S',
                status: 'active',
                cached_health: 'at_risk',
            });
            await GoalshqProjectStrategy.create({
                strategy_id: strategy.id,
                project_id: project.id,
                user_id: user.id,
            });
            await Task.create({
                user_id: user.id,
                name: 'At-risk task',
                project_id: project.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(1),
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('resurface');
            expect(event.new_due_date).toBeNull();
        });

        it('classifies a high-priority task as "resurface" even without goalshq linkage risk', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            await Task.create({
                user_id: user.id,
                name: 'Important task',
                project_id: project.id,
                priority: Task.PRIORITY.HIGH,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(1),
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('resurface');
        });

        it('does not classify a task that is not actually overdue yet', async () => {
            await Task.create({
                user_id: user.id,
                name: 'Future task',
                status: Task.STATUS.NOT_STARTED,
                due_date: new Date(Date.now() + 5 * 86_400_000),
            });

            const result = await classifyOverdueTasks();
            expect(result.classified).toBe(0);
        });

        it('does not reclassify a task that already has a pending event', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });

            await classifyOverdueTasks();
            const secondRun = await classifyOverdueTasks();
            expect(secondRun.classified).toBe(0);

            const events = await TaskCarryoverEvent.findAll({
                where: { task_id: task.id },
            });
            expect(events).toHaveLength(1);
        });

        it('classifies an unlinked task one day under the drop threshold as "reschedule", not "drop"', async () => {
            await Task.create({
                user_id: user.id,
                name: 'Almost stale',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(13), // DROP_THRESHOLD_DAYS default is 14
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('reschedule');
            expect(event.new_due_date).not.toBeNull();
        });

        it('classifies an unlinked task exactly at the drop threshold as "drop"', async () => {
            await Task.create({
                user_id: user.id,
                name: 'Exactly stale',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(14), // DROP_THRESHOLD_DAYS default is 14
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('drop');
        });

        it('classifies a direct goal-linked (no project) at-risk task as "resurface"', async () => {
            const goal = await Goal.create({
                user_id: user.id,
                title: 'Direct goal',
                horizon: 'season',
                status: 'active',
            });
            const { GoalshqGoalSettings } = require('../../models');
            await GoalshqGoalSettings.create({
                goal_id: goal.id,
                user_id: user.id,
                cached_execution_health: 'off_track',
            });
            await Task.create({
                user_id: user.id,
                name: 'Direct at-risk task',
                goal_id: goal.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(1),
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            expect(event.classification).toBe('resurface');
            expect(event.new_due_date).toBeNull();
        });

        it('classifies a direct goal-linked (no project) healthy, low-priority, long-overdue task as "reschedule", never "drop"', async () => {
            const goal = await Goal.create({
                user_id: user.id,
                title: 'Healthy direct goal',
                horizon: 'season',
                status: 'active',
            });
            const { GoalshqGoalSettings } = require('../../models');
            await GoalshqGoalSettings.create({
                goal_id: goal.id,
                user_id: user.id,
                cached_execution_health: 'on_track',
            });
            await Task.create({
                user_id: user.id,
                name: 'Direct healthy task, very overdue',
                goal_id: goal.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(30), // would be "drop" territory if unlinked
            });

            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { user_id: user.id },
            });
            // Linked tasks are never dropped, regardless of how long overdue.
            expect(event.classification).toBe('reschedule');
            expect(event.new_due_date).not.toBeNull();
        });

        it('respects per-user timezone when deciding whether a task is overdue yet', async () => {
            jest.useFakeTimers({
                now: new Date('2026-09-05T02:00:00.000Z'),
                doNotFake: [
                    'nextTick',
                    'setImmediate',
                    'setTimeout',
                    'clearTimeout',
                    'setInterval',
                    'clearInterval',
                ],
            });
            try {
                // 2026-09-04T20:00:00Z: for a UTC user this is "yesterday" (overdue).
                // For a Pacific/Honolulu (UTC-10) user, that instant is 2026-09-04T10:00
                // local time - still within their "today" (Sep 4), so NOT overdue yet.
                const honoluluUser = await createTestUser({
                    email: 'honolulu@example.com',
                    timezone: 'Pacific/Honolulu',
                });
                const utcTask = await Task.create({
                    user_id: user.id,
                    name: 'UTC user task',
                    status: Task.STATUS.NOT_STARTED,
                    due_date: new Date('2026-09-04T20:00:00.000Z'),
                });
                const honoluluTask = await Task.create({
                    user_id: honoluluUser.id,
                    name: 'Honolulu user task',
                    status: Task.STATUS.NOT_STARTED,
                    due_date: new Date('2026-09-04T20:00:00.000Z'),
                });

                const result = await classifyOverdueTasks();
                expect(result.classified).toBe(1);

                const utcEvent = await TaskCarryoverEvent.findOne({
                    where: { task_id: utcTask.id },
                });
                expect(utcEvent).not.toBeNull();

                const honoluluEvent = await TaskCarryoverEvent.findOne({
                    where: { task_id: honoluluTask.id },
                });
                expect(honoluluEvent).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('API', () => {
        it("GET /api/tasks/carryover only returns the current user's pending events", async () => {
            const otherUser = await createTestUser({
                email: 'other@example.com',
            });
            await Task.create({
                user_id: otherUser.id,
                name: 'Other user task',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await Task.create({
                user_id: user.id,
                name: 'My task',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();

            const res = await agent.get('/api/tasks/carryover');
            expect(res.status).toBe(200);
            expect(res.body.events).toHaveLength(1);
            expect(res.body.events[0].task_name).toBe('My task');
        });

        it('GET /api/tasks/carryover/history returns both reviewed and pending events, scoped to the current user', async () => {
            const otherUser = await createTestUser({
                email: 'other-history@example.com',
            });
            await Task.create({
                user_id: otherUser.id,
                name: "Other user's task",
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            const myTask = await Task.create({
                user_id: user.id,
                name: 'My reviewed task',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: myTask.id },
            });
            await agent.post(`/api/tasks/carryover/${event.id}/accept`);

            const res = await agent.get('/api/tasks/carryover/history');
            expect(res.status).toBe(200);
            expect(res.body.events).toHaveLength(1);
            expect(res.body.events[0].task_name).toBe('My reviewed task');
            // unlike the pending-queue endpoint, a reviewed event still shows up
            expect(res.body.events[0].reviewed_at).not.toBeNull();
        });

        it('GET /api/tasks/carryover/history still shows an event whose task was later deleted', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Doomed task',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            await forceDeleteTaskWithoutCascade(task.id);

            const res = await agent.get('/api/tasks/carryover/history');
            expect(res.status).toBe(200);
            expect(res.body.events).toHaveLength(1);
            expect(res.body.events[0].task_name).toBeNull();
            expect(res.body.events[0].task_uid).toBeNull();
        });

        it('accept on "reschedule" applies new_due_date to the task', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            const task = await Task.create({
                user_id: user.id,
                name: 'Linked task',
                project_id: project.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(2),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });

            const res = await agent.post(
                `/api/tasks/carryover/${event.id}/accept`
            );
            expect(res.status).toBe(200);
            expect(res.body.event.reviewed_at).not.toBeNull();

            await task.reload();
            expect(new Date(task.due_date).toISOString().slice(0, 10)).toBe(
                event.new_due_date
            );
        });

        it('accept on "drop" cancels the task', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });

            await agent.post(`/api/tasks/carryover/${event.id}/accept`);

            await task.reload();
            expect(task.status).toBe(Task.STATUS.CANCELLED);
        });

        it('accept on "resurface" does not touch the task', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            const task = await Task.create({
                user_id: user.id,
                name: 'Important task',
                project_id: project.id,
                priority: Task.PRIORITY.HIGH,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(1),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            const originalDueDate = task.due_date;

            await agent.post(`/api/tasks/carryover/${event.id}/accept`);

            await task.reload();
            expect(task.status).toBe(Task.STATUS.NOT_STARTED);
            expect(task.due_date).toEqual(originalDueDate);
        });

        it('override changes the classification and applies the new effect', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            expect(event.classification).toBe('drop');

            const tomorrowStr = new Date(Date.now() + 86_400_000)
                .toISOString()
                .slice(0, 10);
            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({
                    classification: 'reschedule',
                    new_due_date: tomorrowStr,
                });

            expect(res.status).toBe(200);
            expect(res.body.event.classification).toBe('reschedule');
            expect(res.body.event.source).toBe('user_override');

            await task.reload();
            expect(task.status).toBe(Task.STATUS.NOT_STARTED); // not cancelled anymore
            expect(new Date(task.due_date).toISOString().slice(0, 10)).toBe(
                tomorrowStr
            );
        });

        it('rejects acting on an already-reviewed event', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            await agent.post(`/api/tasks/carryover/${event.id}/accept`);

            const res = await agent.post(
                `/api/tasks/carryover/${event.id}/accept`
            );
            expect(res.status).toBe(400);
        });

        it("404s when acting on another user's event", async () => {
            const otherUser = await createTestUser({
                email: 'other2@example.com',
            });
            const task = await Task.create({
                user_id: otherUser.id,
                name: 'Not mine',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });

            const res = await agent.post(
                `/api/tasks/carryover/${event.id}/accept`
            );
            expect(res.status).toBe(404);
        });

        it('rejects overriding an already-reviewed event', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            await agent.post(`/api/tasks/carryover/${event.id}/accept`);

            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({ classification: 'resurface' });
            expect(res.status).toBe(400);
        });

        it('rejects an override with an invalid classification value', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });

            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({ classification: 'bogus' });
            expect(res.status).toBe(400);

            await task.reload();
            expect(task.status).toBe(Task.STATUS.NOT_STARTED); // untouched
        });

        it('rejects overriding to "reschedule" without a new_due_date', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Stale orphan',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });

            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({ classification: 'reschedule' });
            expect(res.status).toBe(400);

            await task.reload();
            expect(task.due_date).not.toBeNull();
            expect(task.status).toBe(Task.STATUS.NOT_STARTED); // untouched
        });

        it('override to "drop" cancels the task even if auto-classified as "reschedule"', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            const task = await Task.create({
                user_id: user.id,
                name: 'Linked task',
                project_id: project.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(2),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            expect(event.classification).toBe('reschedule');

            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({ classification: 'drop' });
            expect(res.status).toBe(200);
            expect(res.body.event.classification).toBe('drop');
            expect(res.body.event.new_due_date).toBeNull();

            await task.reload();
            expect(task.status).toBe(Task.STATUS.CANCELLED);
        });

        it('override to "resurface" leaves the task untouched and clears any proposed due date', async () => {
            const project = await Project.create({
                user_id: user.id,
                name: 'P',
                status: 'in_progress',
            });
            const task = await Task.create({
                user_id: user.id,
                name: 'Linked task',
                project_id: project.id,
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(2),
            });
            const originalDueDate = task.due_date;
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            expect(event.classification).toBe('reschedule');

            const res = await agent
                .post(`/api/tasks/carryover/${event.id}/override`)
                .send({ classification: 'resurface' });
            expect(res.status).toBe(200);
            expect(res.body.event.classification).toBe('resurface');
            expect(res.body.event.new_due_date).toBeNull();

            await task.reload();
            expect(task.status).toBe(Task.STATUS.NOT_STARTED);
            expect(task.due_date).toEqual(originalDueDate);
        });

        it('listPending skips events whose underlying task no longer exists', async () => {
            const task = await Task.create({
                user_id: user.id,
                name: 'Doomed task',
                status: Task.STATUS.NOT_STARTED,
                due_date: daysAgo(20),
            });
            await classifyOverdueTasks();
            const event = await TaskCarryoverEvent.findOne({
                where: { task_id: task.id },
            });
            expect(event).not.toBeNull();

            await forceDeleteTaskWithoutCascade(task.id);

            // The event row itself must still be there (proving the endpoint
            // below is actually exercising listPending()'s `.filter((e) =>
            // e.Task)` defensive filter, not just returning empty because the
            // row happens to be gone).
            const survivingEvent = await TaskCarryoverEvent.findByPk(event.id);
            expect(survivingEvent).not.toBeNull();

            const res = await agent.get('/api/tasks/carryover');
            expect(res.status).toBe(200);
            expect(res.body.events).toHaveLength(0);
        });
    });
});
