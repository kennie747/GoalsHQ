const mockCreate = jest.fn();

jest.mock('openai', () => jest.fn());

const OpenAI = require('openai');
const { createTestUser } = require('../../../helpers/testUtils');
const aiAssistantService = require('../../../../modules/ai-assistant/service');
const {
    Goal,
    GoalshqStrategy,
    GoalshqGoalSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    Task,
    TaskCarryoverEvent,
} = require('../../../../models');

describe('AI Assistant - GoalsHQ Strategy/KR context (Phase E)', () => {
    let user;

    beforeEach(async () => {
        process.env.LLM_API_KEY = 'test-key';
        delete process.env.GOALSHQ_ENABLED;

        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '{}' } }],
            model: 'test-model',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
        OpenAI.mockImplementation(() => ({
            chat: { completions: { create: (...args) => mockCreate(...args) } },
        }));

        user = await createTestUser({ email: 'ai-goalshq@example.com' });
    });

    afterEach(() => {
        delete process.env.LLM_API_KEY;
        delete process.env.GOALSHQ_ENABLED;
    });

    function userMessageContent() {
        return mockCreate.mock.calls[0][0].messages[1].content;
    }

    it('includes an at-risk strategy with its key results and milestones in the context', async () => {
        const goal = await Goal.create({
            user_id: user.id,
            title: 'Ship the redesign',
            horizon: 'season',
            status: 'active',
        });
        await GoalshqGoalSettings.create({
            goal_id: goal.id,
            user_id: user.id,
            cached_health: 'on_track',
        });
        const strategy = await GoalshqStrategy.create({
            goal_id: goal.id,
            user_id: user.id,
            name: 'Beta launch',
            status: 'active',
            importance: 5,
            cached_percent: 42,
            cached_health: 'off_track',
        });
        await GoalshqKeyResult.create({
            parent_type: 'strategy',
            parent_id: strategy.id,
            user_id: user.id,
            name: 'Beta signups',
            unit: 'signups',
            direction: 'increase',
            baseline_value: 0,
            target_value: 100,
            current_value: 30,
        });
        await GoalshqMilestone.create({
            parent_type: 'strategy',
            parent_id: strategy.id,
            user_id: user.id,
            title: 'Beta launched',
            target_date: '2026-10-01',
            status: 'pending',
        });

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).toContain('## Strategy & Key Results');
        expect(content).toContain('"Beta launch"');
        expect(content).toContain('[off_track]');
        expect(content).toContain('→ Goal: "Ship the redesign"');
        expect(content).toContain('KR: Beta signups — 30/100 signups (30%)');
        expect(content).toContain('Milestone: Beta launched [pending]');
        // The Goal itself also gets its own cached health inline.
        expect(content).toContain('"Ship the redesign"');
        expect(content).toContain('[on_track]');
    });

    it('caps the Strategy & Key Results section to the top 8, risk-first then importance', async () => {
        const goal = await Goal.create({
            user_id: user.id,
            title: 'Many strategies goal',
            horizon: 'season',
            status: 'active',
        });
        for (let i = 0; i < 10; i++) {
            await GoalshqStrategy.create({
                goal_id: goal.id,
                user_id: user.id,
                name: `Strategy ${i}`,
                status: 'active',
                importance: i,
                cached_health: 'on_track',
            });
        }

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).toContain('## Strategy & Key Results (top 8)');
        // Highest-importance strategies (9, 8, ... down to 2) should be kept;
        // the two lowest-importance ones (0, 1) should be dropped.
        expect(content).toContain('"Strategy 9"');
        expect(content).toContain('"Strategy 2"');
        expect(content).not.toContain('"Strategy 0"');
        expect(content).not.toContain('"Strategy 1"');
    });

    it('omits the Strategy & Key Results section when GoalsHQ is disabled', async () => {
        process.env.GOALSHQ_ENABLED = 'false';
        const goal = await Goal.create({
            user_id: user.id,
            title: 'Goal with a strategy',
            horizon: 'season',
            status: 'active',
        });
        await GoalshqStrategy.create({
            goal_id: goal.id,
            user_id: user.id,
            name: 'Should not appear',
            status: 'active',
            cached_health: 'off_track',
        });

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).not.toContain('## Strategy & Key Results');
        expect(content).not.toContain('Should not appear');
    });

    it('omits the Strategy & Key Results section when there are no strategies or goal settings', async () => {
        await Goal.create({
            user_id: user.id,
            title: 'Bare goal',
            horizon: 'season',
            status: 'active',
        });

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).not.toContain('## Strategy & Key Results');
    });

    it('surfaces a task carried over 2+ times under "Keeps Getting Postponed"', async () => {
        const task = await Task.create({
            user_id: user.id,
            name: 'Chronically postponed task',
            status: Task.STATUS.NOT_STARTED,
        });
        await TaskCarryoverEvent.bulkCreate([
            {
                task_id: task.id,
                user_id: user.id,
                occurred_on: '2026-08-01',
                classification: 'reschedule',
                previous_due_date: '2026-07-31',
                new_due_date: '2026-08-01',
                source: 'auto',
                reviewed_at: new Date(),
            },
            {
                task_id: task.id,
                user_id: user.id,
                occurred_on: '2026-08-15',
                classification: 'reschedule',
                previous_due_date: '2026-08-14',
                new_due_date: '2026-08-15',
                source: 'auto',
                reviewed_at: new Date(),
            },
        ]);

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).toContain('## Keeps Getting Postponed');
        expect(content).toContain(
            '"Chronically postponed task" — carried over 2x'
        );
    });

    it("never surfaces another user's repeatedly-carried-over task", async () => {
        const otherUser = await createTestUser({
            email: 'ai-goalshq-other@example.com',
        });
        const otherTask = await Task.create({
            user_id: otherUser.id,
            name: "Other user's postponed task",
            status: Task.STATUS.NOT_STARTED,
        });
        await TaskCarryoverEvent.bulkCreate([
            {
                task_id: otherTask.id,
                user_id: otherUser.id,
                occurred_on: '2026-08-01',
                classification: 'reschedule',
                previous_due_date: '2026-07-31',
                new_due_date: '2026-08-01',
                source: 'auto',
                reviewed_at: new Date(),
            },
            {
                task_id: otherTask.id,
                user_id: otherUser.id,
                occurred_on: '2026-08-15',
                classification: 'reschedule',
                previous_due_date: '2026-08-14',
                new_due_date: '2026-08-15',
                source: 'auto',
                reviewed_at: new Date(),
            },
        ]);

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).not.toContain('## Keeps Getting Postponed');
        expect(content).not.toContain("Other user's postponed task");
    });

    it('does not surface a task rescheduled only once', async () => {
        const task = await Task.create({
            user_id: user.id,
            name: 'Rescheduled once',
            status: Task.STATUS.NOT_STARTED,
        });
        await TaskCarryoverEvent.create({
            task_id: task.id,
            user_id: user.id,
            occurred_on: '2026-08-01',
            classification: 'reschedule',
            previous_due_date: '2026-07-31',
            new_due_date: '2026-08-01',
            source: 'auto',
            reviewed_at: new Date(),
        });

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).not.toContain('## Keeps Getting Postponed');
    });

    it('excludes a repeatedly-carried-over task once it is completed', async () => {
        const task = await Task.create({
            user_id: user.id,
            name: 'Finally done',
            status: Task.STATUS.DONE,
        });
        await TaskCarryoverEvent.bulkCreate([
            {
                task_id: task.id,
                user_id: user.id,
                occurred_on: '2026-08-01',
                classification: 'reschedule',
                previous_due_date: '2026-07-31',
                new_due_date: '2026-08-01',
                source: 'auto',
                reviewed_at: new Date(),
            },
            {
                task_id: task.id,
                user_id: user.id,
                occurred_on: '2026-08-15',
                classification: 'reschedule',
                previous_due_date: '2026-08-14',
                new_due_date: '2026-08-15',
                source: 'auto',
                reviewed_at: new Date(),
            },
        ]);

        await aiAssistantService.generateDailyBrief(user.id);

        const content = userMessageContent();
        expect(content).not.toContain('## Keeps Getting Postponed');
        expect(content).not.toContain('Finally done');
    });
});
