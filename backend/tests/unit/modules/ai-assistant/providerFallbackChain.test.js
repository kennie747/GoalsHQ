const mockOpenAI = jest.fn();
jest.mock('openai', () => mockOpenAI);

const OpenAI = require('openai');
const { createTestUser } = require('../../../helpers/testUtils');
const aiAssistantService = require('../../../../modules/ai-assistant/service');

const ENV_KEYS = [
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
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

const OPENROUTER_URL = 'https://fake-openrouter.test/v1';
const GEMINI_URL = 'https://fake-gemini.test/v1beta/openai/';
const GROQ_URL = 'https://fake-groq.test/v1';
const OLLAMA_URL = 'http://fake-ollama.test/v1';

function jsonMessage(obj) {
    return {
        choices: [{ message: { content: JSON.stringify(obj) } }],
        model: 'x',
        usage: {},
    };
}

describe('AI Assistant — multi-provider fallback chain', () => {
    let savedEnv;
    let handlers;
    let user;
    let userCounter = 0;

    beforeEach(async () => {
        savedEnv = {};
        ENV_KEYS.forEach((k) => {
            savedEnv[k] = process.env[k];
            delete process.env[k];
        });

        // getProviderChain()/callLLM() read process.env live on every call, so
        // no module reset is needed between tests for env changes to take
        // effect. `handlers` is reassigned (not redeclared) each test, and
        // every mock client's `create` closes over this same binding, so even
        // a client cached from an earlier test still resolves against the
        // current test's handlers.
        handlers = {};
        OpenAI.mockImplementation((opts) => ({
            chat: {
                completions: {
                    create: (params) => {
                        const handler = handlers[opts.baseURL];
                        if (!handler) {
                            return Promise.reject(
                                new Error(
                                    `no mock handler for baseURL ${opts.baseURL}`
                                )
                            );
                        }
                        return handler(params);
                    },
                },
            },
        }));

        userCounter += 1;
        user = await createTestUser({
            email: `fallback-${userCounter}@example.com`,
        });
    });

    afterEach(() => {
        ENV_KEYS.forEach((k) => {
            if (savedEnv[k] === undefined) delete process.env[k];
            else process.env[k] = savedEnv[k];
        });
    });

    function configureAllTiers() {
        process.env.LLM_OPENROUTER_API_KEY = 'or-key';
        process.env.LLM_OPENROUTER_BASE_URL = OPENROUTER_URL;
        process.env.LLM_OPENROUTER_MODELS = 'model-a,model-b';
        process.env.LLM_GEMINI_API_KEY = 'gem-key';
        process.env.LLM_GEMINI_BASE_URL = GEMINI_URL;
        process.env.LLM_GEMINI_MODEL = 'gemini-model';
        process.env.LLM_GROQ_API_KEY = 'groq-key';
        process.env.LLM_GROQ_BASE_URL = GROQ_URL;
        process.env.LLM_GROQ_MODEL = 'groq-model';
        process.env.LLM_OLLAMA_BASE_URL = OLLAMA_URL;
        process.env.LLM_OLLAMA_MODEL = 'ollama-model';
    }

    it('builds the chain in order: openrouter (each model) -> gemini -> groq -> ollama', () => {
        configureAllTiers();
        const summary = aiAssistantService.getProviderChainSummary();
        expect(summary.map((s) => `${s.label}:${s.model}`)).toEqual([
            'openrouter:model-a',
            'openrouter:model-b',
            'gemini:gemini-model',
            'groq:groq-model',
            'ollama:ollama-model',
        ]);
    });

    it('isAIConfigured is false when no tier is configured, true once one is', () => {
        expect(aiAssistantService.isAIConfigured()).toBe(false);
        process.env.LLM_OLLAMA_BASE_URL = OLLAMA_URL;
        expect(aiAssistantService.isAIConfigured()).toBe(true);
    });

    it('uses the first tier when it succeeds, without touching any other tier', async () => {
        configureAllTiers();
        handlers[OPENROUTER_URL] = jest.fn().mockResolvedValue(
            jsonMessage({
                overview: 'ok',
                focus: 'f',
                priority_actions: [],
                watch_out: [],
            })
        );
        handlers[GEMINI_URL] = jest.fn();
        handlers[GROQ_URL] = jest.fn();
        handlers[OLLAMA_URL] = jest.fn();

        const brief = await aiAssistantService.generateDailyBrief(user.id);

        expect(brief.overview).toBe('ok');
        expect(handlers[OPENROUTER_URL]).toHaveBeenCalledTimes(1);
        expect(handlers[GEMINI_URL]).not.toHaveBeenCalled();
        expect(handlers[GROQ_URL]).not.toHaveBeenCalled();
        expect(handlers[OLLAMA_URL]).not.toHaveBeenCalled();
    });

    it('falls through openrouter (both models) and gemini to reach groq', async () => {
        configureAllTiers();
        handlers[OPENROUTER_URL] = jest
            .fn()
            .mockRejectedValue(new Error('openrouter down'));
        handlers[GEMINI_URL] = jest
            .fn()
            .mockRejectedValue(new Error('gemini down'));
        handlers[GROQ_URL] = jest.fn().mockResolvedValue(
            jsonMessage({
                overview: 'groq-answered',
                focus: 'f',
                priority_actions: [],
                watch_out: [],
            })
        );
        handlers[OLLAMA_URL] = jest.fn();

        const brief = await aiAssistantService.generateDailyBrief(user.id);

        expect(brief.overview).toBe('groq-answered');
        // openrouter is tried once per configured model (2 models here)
        expect(handlers[OPENROUTER_URL]).toHaveBeenCalledTimes(2);
        expect(handlers[GEMINI_URL]).toHaveBeenCalledTimes(1);
        expect(handlers[GROQ_URL]).toHaveBeenCalledTimes(1);
        expect(handlers[OLLAMA_URL]).not.toHaveBeenCalled();
    });

    it('falls all the way through to ollama when every hosted tier fails', async () => {
        configureAllTiers();
        handlers[OPENROUTER_URL] = jest
            .fn()
            .mockRejectedValue(new Error('openrouter down'));
        handlers[GEMINI_URL] = jest
            .fn()
            .mockRejectedValue(new Error('gemini down'));
        handlers[GROQ_URL] = jest
            .fn()
            .mockRejectedValue(new Error('groq down'));
        handlers[OLLAMA_URL] = jest.fn().mockResolvedValue(
            jsonMessage({
                overview: 'ollama-saved-the-day',
                focus: 'f',
                priority_actions: [],
                watch_out: [],
            })
        );

        const brief = await aiAssistantService.generateDailyBrief(user.id);

        expect(brief.overview).toBe('ollama-saved-the-day');
        expect(handlers[OLLAMA_URL]).toHaveBeenCalledTimes(1);
    });

    it('throws AI_ALL_PROVIDERS_FAILED (503) when every tier, including ollama, fails', async () => {
        configureAllTiers();
        handlers[OPENROUTER_URL] = jest
            .fn()
            .mockRejectedValue(new Error('openrouter down'));
        handlers[GEMINI_URL] = jest
            .fn()
            .mockRejectedValue(new Error('gemini down'));
        handlers[GROQ_URL] = jest
            .fn()
            .mockRejectedValue(new Error('groq down'));
        handlers[OLLAMA_URL] = jest
            .fn()
            .mockRejectedValue(new Error('ollama down'));

        await expect(
            aiAssistantService.generateDailyBrief(user.id)
        ).rejects.toMatchObject({
            code: 'AI_ALL_PROVIDERS_FAILED',
            statusCode: 503,
        });
    });

    it('skips an expired Groq tier automatically, without attempting it', () => {
        configureAllTiers();
        process.env.LLM_GROQ_EXPIRES_AT = '2000-01-01';

        const summary = aiAssistantService.getProviderChainSummary();
        expect(summary.map((s) => s.label)).not.toContain('groq');
    });

    it('keeps a non-expired Groq tier in the chain', () => {
        configureAllTiers();
        const future = new Date(Date.now() + 30 * 86_400_000)
            .toISOString()
            .slice(0, 10);
        process.env.LLM_GROQ_EXPIRES_AT = future;

        const summary = aiAssistantService.getProviderChainSummary();
        expect(summary.map((s) => s.label)).toContain('groq');
    });

    it('treats legacy LLM_API_KEY/LLM_BASE_URL/LLM_MODEL as tier 0, ahead of the named tiers', () => {
        process.env.LLM_API_KEY = 'legacy-key';
        process.env.LLM_BASE_URL = 'https://fake-legacy.test/v1';
        process.env.LLM_MODEL = 'legacy-model';
        configureAllTiers();

        const summary = aiAssistantService.getProviderChainSummary();
        expect(summary[0]).toMatchObject({
            label: 'primary',
            model: 'legacy-model',
        });
    });

    it('reproduces old single-provider behavior exactly when only legacy vars are set', async () => {
        process.env.LLM_API_KEY = 'legacy-key';
        process.env.LLM_BASE_URL = 'https://fake-legacy.test/v1';
        process.env.LLM_MODEL = 'legacy-model';
        handlers['https://fake-legacy.test/v1'] = jest.fn().mockResolvedValue(
            jsonMessage({
                overview: 'legacy-ok',
                focus: 'f',
                priority_actions: [],
                watch_out: [],
            })
        );

        const brief = await aiAssistantService.generateDailyBrief(user.id);
        expect(brief.overview).toBe('legacy-ok');
    });

    it('GET /config-equivalent: getProviderChainSummary never leaks api keys', () => {
        configureAllTiers();
        const summary = aiAssistantService.getProviderChainSummary();
        const serialized = JSON.stringify(summary);
        expect(serialized).not.toContain('or-key');
        expect(serialized).not.toContain('gem-key');
        expect(serialized).not.toContain('groq-key');
    });
});
