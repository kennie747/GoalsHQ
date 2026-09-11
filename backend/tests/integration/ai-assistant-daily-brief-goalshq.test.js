const mockCreate = jest.fn();

jest.mock('openai', () => jest.fn());

const request = require('supertest');
const OpenAI = require('openai');
const app = require('../../app');
const { createTestUser } = require('../helpers/testUtils');
const {
    Goal,
    GoalshqStrategy,
    Task,
    TaskCarryoverEvent,
} = require('../../models');

describe('POST /api/ai-assistant/daily-brief (Phase E, GoalsHQ context wired end-to-end)', () => {
    let user, agent;
    const savedEnv = {};

    beforeEach(async () => {
        savedEnv.llmKey = process.env.LLM_API_KEY;
        process.env.LLM_API_KEY = 'test-key';

        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            overview: 'Momentum is fine.',
                            focus: 'Ship the beta',
                            priority_actions: [],
                            watch_out: [],
                        }),
                    },
                },
            ],
            model: 'test-model',
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
        OpenAI.mockImplementation(() => ({
            chat: { completions: { create: (...args) => mockCreate(...args) } },
        }));

        user = await createTestUser({ email: 'ai-e2e@example.com' });
        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'ai-e2e@example.com',
            password: 'password123',
        });
    });

    afterEach(() => {
        if (savedEnv.llmKey === undefined) {
            delete process.env.LLM_API_KEY;
        } else {
            process.env.LLM_API_KEY = savedEnv.llmKey;
        }
    });

    it('rejects an unauthenticated request', async () => {
        const res = await request(app).post('/api/ai-assistant/daily-brief');
        expect(res.status).toBe(401);
    });

    it('returns a 200 brief and actually forwards GoalsHQ strategy context to the LLM call', async () => {
        const goal = await Goal.create({
            user_id: user.id,
            title: 'Ship the redesign',
            horizon: 'season',
            status: 'active',
        });
        await GoalshqStrategy.create({
            goal_id: goal.id,
            user_id: user.id,
            name: 'Beta launch',
            status: 'active',
            importance: 5,
            cached_health: 'off_track',
        });
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

        const res = await agent.post('/api/ai-assistant/daily-brief');

        expect(res.status).toBe(200);
        expect(res.body.overview).toBe('Momentum is fine.');
        expect(res.body.focus).toBe('Ship the beta');
        expect(res.body.generated_at).toEqual(expect.any(String));

        // Prove the enriched context actually reached the LLM call, not just
        // that generateDailyBrief() works in isolation from a unit test.
        expect(mockCreate).toHaveBeenCalledTimes(1);
        const sentContext = mockCreate.mock.calls[0][0].messages[1].content;
        expect(sentContext).toContain('"Beta launch"');
        expect(sentContext).toContain('[off_track]');
        expect(sentContext).toContain(
            '"Chronically postponed task" — carried over 2x'
        );
    });

    it('persists the brief so a subsequent cached-brief fetch returns it', async () => {
        await agent.post('/api/ai-assistant/daily-brief');

        const res = await agent.get('/api/ai-assistant/daily-brief');
        expect(res.status).toBe(200);
        expect(res.body.overview).toBe('Momentum is fine.');
    });
});
