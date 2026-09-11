const request = require('supertest');
const app = require('../../app');
const { createTestUser } = require('../helpers/testUtils');

// Every env var that can populate a getProviderChain() tier (see
// modules/ai-assistant/service.js) — a real .env may have any of these set
// for local development, and this suite must simulate "nothing configured"
// regardless, or it silently makes real calls to whichever hosted provider
// is configured.
const PROVIDER_ENV_KEYS = [
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'TUDUDI_AI_MODEL',
    'LLM_OPENROUTER_API_KEY',
    'LLM_OPENROUTER_BASE_URL',
    'LLM_OPENROUTER_MODELS',
    'LLM_GEMINI_API_KEY',
    'LLM_GEMINI_BASE_URL',
    'LLM_GEMINI_MODEL',
    'LLM_GROQ_API_KEY',
    'LLM_GROQ_BASE_URL',
    'LLM_GROQ_MODEL',
    'LLM_GROQ_EXPIRES_AT',
    'LLM_OLLAMA_API_KEY',
    'LLM_OLLAMA_BASE_URL',
    'LLM_OLLAMA_MODEL',
];

describe('AI Assistant - missing LLM configuration', () => {
    let agent;
    const savedEnv = {};

    beforeEach(async () => {
        PROVIDER_ENV_KEYS.forEach((key) => {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        });

        await createTestUser({ email: 'ai-config@example.com' });

        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'ai-config@example.com',
            password: 'password123',
        });
    });

    afterEach(() => {
        PROVIDER_ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        });
    });

    it('reports api_key_set false from the config endpoint', async () => {
        const response = await agent.get('/api/ai-assistant/config');

        expect(response.status).toBe(200);
        expect(response.body.api_key_set).toBe(false);
    });

    it('returns 503 AI_NOT_CONFIGURED for the daily brief', async () => {
        const response = await agent.post('/api/ai-assistant/daily-brief');

        expect(response.status).toBe(503);
        expect(response.body.code).toBe('AI_NOT_CONFIGURED');
        expect(response.body.error).toMatch(/LLM_API_KEY/);
    });

    it('returns 503 AI_NOT_CONFIGURED for task insights', async () => {
        const response = await agent
            .post('/api/ai-assistant/task-insights')
            .send({ taskName: 'Write the report' });

        expect(response.status).toBe(503);
        expect(response.body.code).toBe('AI_NOT_CONFIGURED');
    });

    it('returns 503 AI_NOT_CONFIGURED for project insights', async () => {
        const response = await agent
            .post('/api/ai-assistant/project-insights')
            .send({ projectName: 'Website redesign' });

        expect(response.status).toBe(503);
        expect(response.body.code).toBe('AI_NOT_CONFIGURED');
    });

    it('keeps the actionable message in production mode', async () => {
        const savedNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            // CSRF protection is only enforced outside the test environment
            const { body } = await agent.get('/api/csrf-token');
            const response = await agent
                .post('/api/ai-assistant/daily-brief')
                .set('x-csrf-token', body.csrfToken);

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('AI_NOT_CONFIGURED');
            expect(response.body.error).not.toBe('Internal server error');
        } finally {
            process.env.NODE_ENV = savedNodeEnv;
        }
    });

    it('accepts a configured key again', async () => {
        process.env.LLM_API_KEY = 'test-key';

        const response = await agent.get('/api/ai-assistant/config');

        expect(response.status).toBe(200);
        expect(response.body.api_key_set).toBe(true);
    });
});
