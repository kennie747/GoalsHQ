'use strict';

const OpenAI = require('openai');
const moment = require('moment-timezone');
const { Op, fn, col, literal } = require('sequelize');
const {
    User,
    Goal,
    Project,
    Area,
    Task,
    TaskCarryoverEvent,
} = require('../../models');
const { computeTaskMetrics } = require('../tasks/queries/metrics-computation');
const { AppError } = require('../../shared/errors');
const goalshqRepo = require('../goalshq/repository');
const { isEnabled: isGoalshqEnabled } = require('../goalshq/service');
const { keyResultPercent } = require('../goalshq/operations/progress-math');

const AT_RISK_HEALTH = ['at_risk', 'off_track'];
const MAX_CONTEXT_STRATEGIES = 8;
const MAX_REPEAT_CARRYOVER_TASKS = 5;

const PRIORITY_LABELS = { 0: 'low', 1: 'medium', 2: 'high' };
const STATUS_LABELS = {
    0: 'not started',
    1: 'in progress',
    2: 'done',
    3: 'archived',
    4: 'waiting',
    5: 'cancelled',
    6: 'planned',
};

function parseExpiry(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d;
}

function isExpired(expiryDate) {
    return expiryDate != null && Date.now() > expiryDate.getTime();
}

/**
 * Ordered fallback chain of {label, apiKey, baseUrl, model} attempts —
 * callLLM() below tries each in order and only moves to the next on failure.
 * A tier is included only when its env vars are set, so an unconfigured tier
 * is simply absent rather than attempted-and-skipped.
 *
 * The legacy single-provider vars (LLM_API_KEY/LLM_BASE_URL/LLM_MODEL,
 * or OPENAI_API_KEY/OPENAI_BASE_URL) are kept as an always-first "primary"
 * tier for anyone who hasn't adopted the multi-tier vars below — for them
 * this chain has exactly one entry, identical to the old single-provider
 * behavior.
 */
function getProviderChain() {
    const chain = [];

    const legacyKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (legacyKey) {
        chain.push({
            label: 'primary',
            apiKey: legacyKey,
            baseUrl: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL,
            model:
                process.env.LLM_MODEL ||
                process.env.TUDUDI_AI_MODEL ||
                'gpt-4o-mini',
        });
    }

    if (process.env.LLM_OPENROUTER_API_KEY) {
        const models = (process.env.LLM_OPENROUTER_MODELS || '')
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean);
        for (const model of models) {
            chain.push({
                label: 'openrouter',
                apiKey: process.env.LLM_OPENROUTER_API_KEY,
                baseUrl:
                    process.env.LLM_OPENROUTER_BASE_URL ||
                    'https://openrouter.ai/api/v1',
                model,
            });
        }
    }

    if (process.env.LLM_GEMINI_API_KEY) {
        chain.push({
            label: 'gemini',
            apiKey: process.env.LLM_GEMINI_API_KEY,
            baseUrl:
                process.env.LLM_GEMINI_BASE_URL ||
                'https://generativelanguage.googleapis.com/v1beta/openai/',
            model: process.env.LLM_GEMINI_MODEL || 'gemini-3.6-flash',
        });
    }

    if (process.env.LLM_GROQ_API_KEY) {
        const expiresAt = parseExpiry(process.env.LLM_GROQ_EXPIRES_AT);
        if (isExpired(expiresAt)) {
            console.warn(
                `[AI Assistant] Groq API key expired on ${process.env.LLM_GROQ_EXPIRES_AT} — skipping this fallback tier. Generate a new key at https://console.groq.com/keys and update LLM_GROQ_API_KEY / LLM_GROQ_EXPIRES_AT.`
            );
        } else {
            chain.push({
                label: 'groq',
                apiKey: process.env.LLM_GROQ_API_KEY,
                baseUrl:
                    process.env.LLM_GROQ_BASE_URL ||
                    'https://api.groq.com/openai/v1',
                model: process.env.LLM_GROQ_MODEL || 'openai/gpt-oss-120b',
                expiresAt,
            });
        }
    }

    if (process.env.LLM_OLLAMA_BASE_URL) {
        chain.push({
            label: 'ollama',
            apiKey: process.env.LLM_OLLAMA_API_KEY || 'ollama-local',
            baseUrl: process.env.LLM_OLLAMA_BASE_URL,
            model: process.env.LLM_OLLAMA_MODEL || 'qwen2.5:3b-instruct',
        });
    }

    return chain;
}

/** Provider info safe to expose over the API — no api keys. */
function getProviderChainSummary() {
    return getProviderChain().map(({ label, baseUrl, model, expiresAt }) => ({
        label,
        base_url: baseUrl || null,
        model,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
    }));
}

function isAIConfigured() {
    return getProviderChain().length > 0;
}

const clientCache = new Map();
function buildClient(apiKey, baseUrl) {
    const cacheKey = `${baseUrl || ''}|${apiKey}`;
    if (clientCache.has(cacheKey)) return clientCache.get(cacheKey);
    const options = { apiKey };
    if (baseUrl) options.baseURL = baseUrl;
    const client = new OpenAI(options);
    clientCache.set(cacheKey, client);
    return client;
}

function getMaxTokens(envVar, defaultValue) {
    const raw = process.env[envVar];
    if (!raw) return defaultValue;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

// Some self-hosted reasoning models (e.g. Qwen3 served via vLLM) spend their
// entire completion budget on hidden <think> tokens and never emit the final
// answer. vLLM's chat template accepts chat_template_kwargs.enable_thinking
// to skip that phase. Opt-in only: providers that reject unrecognized body
// fields (e.g. strict OpenAI-compatible servers) would otherwise error.
function getExtraBodyParams() {
    if (process.env.LLM_DISABLE_THINKING === 'true') {
        return { chat_template_kwargs: { enable_thinking: false } };
    }
    return {};
}

function extractJSON(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    return fenced ? fenced[1] : raw;
}

// Some OpenAI-compatible reasoning servers put the model's actual answer in
// a reasoning/reasoning_content field and leave message.content null/empty,
// even when the answer text itself is the intended final output (observed
// with some vLLM + reasoning-parser configurations). Fall back to those
// fields so the response isn't discarded just because content is empty.
//
// The fallback field usually holds hidden chain-of-thought rather than the
// answer, so it's only trusted when it actually parses as JSON - otherwise
// callers would cache raw internal reasoning text as if it were the result.
function extractMessageContent(message) {
    if (message?.content) return message.content;
    const fallback = message?.reasoning_content || message?.reasoning;
    if (!fallback) return '{}';
    try {
        JSON.parse(extractJSON(fallback));
        return fallback;
    } catch {
        return '{}';
    }
}

// strict: true is required by Anthropic's OpenAI-compatible endpoint (it
// rejects strict: false with a 400) and is also OpenAI's recommended mode
// for schema-following output. It does mean every schema below must be
// strict-mode compliant: every property listed in "properties" must also be
// listed in "required", and every object level needs
// additionalProperties: false.
function buildResponseFormat(name, schema) {
    return {
        type: 'json_schema',
        json_schema: { name, strict: true, schema },
    };
}

async function callWithFallback(client, params) {
    try {
        return await client.chat.completions.create(params);
    } catch (err) {
        const is400 = err?.status === 400;
        const mentionsFormat =
            err?.message?.includes('response_format') ||
            err?.error?.message?.includes('response_format');
        if (is400 && mentionsFormat) {
            const { response_format: _dropped, ...fallbackParams } = params;
            return await client.chat.completions.create(fallbackParams);
        }
        throw err;
    }
}

/**
 * Try each tier of getProviderChain() in order, using the same request
 * params but a different {client, model} per attempt. Returns the first
 * successful response — response.model reflects whichever tier actually
 * answered. Throws AI_ALL_PROVIDERS_FAILED only when every configured tier
 * has failed (network error, expired/invalid key, rate limit, etc.).
 */
async function callLLM(paramsWithoutModel) {
    const chain = getProviderChain();
    if (chain.length === 0) {
        throw new AppError(
            'AI assistant is not configured. Set LLM_API_KEY (or one of the LLM_OPENROUTER_*/LLM_GEMINI_*/LLM_GROQ_*/LLM_OLLAMA_* fallback tiers) on the server to enable it.',
            503,
            'AI_NOT_CONFIGURED'
        );
    }

    const failures = [];
    for (const tier of chain) {
        try {
            const client = buildClient(tier.apiKey, tier.baseUrl);
            const response = await callWithFallback(client, {
                ...paramsWithoutModel,
                model: tier.model,
            });
            if (failures.length > 0) {
                console.warn(
                    `[AI Assistant] Fell back to tier "${tier.label}" (${tier.model}) after ${failures.length} earlier failure(s): ${failures.map((f) => `${f.tier}/${f.model}`).join(', ')}`
                );
            }
            return response;
        } catch (err) {
            const message = err?.message || String(err);
            console.warn(
                `[AI Assistant] Tier "${tier.label}" (${tier.model}) failed: ${message}`
            );
            failures.push({ tier: tier.label, model: tier.model, message });
        }
    }

    throw new AppError(
        `AI assistant: all ${chain.length} configured provider(s) failed. ${failures.map((f) => `${f.tier}/${f.model}: ${f.message}`).join('; ')}`,
        503,
        'AI_ALL_PROVIDERS_FAILED'
    );
}

/**
 * Batch-resolve the Strategy & Key Result context for a set of active goals,
 * capped to MAX_CONTEXT_STRATEGIES total (a context-budget guard, not an
 * exhaustive listing) — ranked at-risk/off-track first, then by importance.
 * Returns null when GoalsHQ is disabled or there's nothing to show.
 */
async function fetchGoalshqContext(userId, goals) {
    if (!isGoalshqEnabled() || goals.length === 0) return null;

    const goalIds = goals.map((g) => g.id);
    const [goalSettingsByGoalId, strategiesByGoalId] = await Promise.all([
        goalshqRepo.settingsByGoalIds(goalIds),
        goalshqRepo.strategiesByGoalIds(userId, goalIds),
    ]);

    const allStrategies = [...strategiesByGoalId.values()].flat();
    const topStrategies = allStrategies
        .slice()
        .sort((a, b) => {
            const aRisk = AT_RISK_HEALTH.includes(a.cached_health) ? 0 : 1;
            const bRisk = AT_RISK_HEALTH.includes(b.cached_health) ? 0 : 1;
            if (aRisk !== bRisk) return aRisk - bRisk;
            return a.id - b.id;
        })
        .slice(0, MAX_CONTEXT_STRATEGIES);

    const strategyDetails = await Promise.all(
        topStrategies.map(async (strategy) => {
            const [keyResults, milestones] = await Promise.all([
                goalshqRepo.keyResults('strategy', strategy.id),
                goalshqRepo.milestones('strategy', strategy.id),
            ]);
            return { strategy, keyResults, milestones };
        })
    );

    const hasAnything =
        strategyDetails.length > 0 || goalSettingsByGoalId.size > 0;
    if (!hasAnything) return null;

    return { goalSettingsByGoalId, strategiesByGoalId, strategyDetails };
}

/**
 * Tasks that have been auto-classified as "reschedule" 2+ times historically
 * (see backend/modules/tasks/carryover/service.js) — a pattern the daily
 * brief can call out directly instead of the user seeing the same task carry
 * over silently, day after day. Two batched queries, never a per-task one.
 */
async function fetchRepeatCarryoverTasks(
    userId,
    limit = MAX_REPEAT_CARRYOVER_TASKS
) {
    const counts = await TaskCarryoverEvent.findAll({
        where: { user_id: userId, classification: 'reschedule' },
        attributes: ['task_id', [fn('COUNT', col('id')), 'carryover_count']],
        group: ['task_id'],
        having: literal('COUNT(id) >= 2'),
        raw: true,
    });
    if (counts.length === 0) return [];

    const taskIds = counts.map((c) => c.task_id);
    const tasks = await Task.findAll({
        where: {
            id: { [Op.in]: taskIds },
            user_id: userId,
            status: {
                [Op.notIn]: [
                    Task.STATUS.DONE,
                    Task.STATUS.ARCHIVED,
                    Task.STATUS.CANCELLED,
                ],
            },
        },
        attributes: ['id', 'uid', 'name'],
    });

    const countByTaskId = new Map(
        counts.map((c) => [c.task_id, Number(c.carryover_count)])
    );
    return tasks
        .map((t) => ({
            name: t.name,
            uid: t.uid,
            count: countByTaskId.get(t.id) || 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

async function fetchUserContext(userId) {
    const user = await User.findByPk(userId, {
        attributes: ['id', 'timezone', 'email', 'ai_profile'],
    });
    if (!user) throw new Error('User not found');

    const timezone = user.timezone || 'UTC';

    const [goals, projects, metrics] = await Promise.all([
        Goal.findAll({
            where: { user_id: userId, status: 'active' },
            include: [{ model: Area, attributes: ['name'], required: false }],
            order: [['created_at', 'ASC']],
        }),
        Project.findAll({
            where: {
                user_id: userId,
                status: ['in_progress', 'planned', 'waiting'],
            },
            include: [
                { model: Area, attributes: ['name'], required: false },
                {
                    model: Goal,
                    as: 'Goal',
                    attributes: ['title'],
                    required: false,
                },
            ],
            order: [['created_at', 'ASC']],
        }),
        computeTaskMetrics(userId, timezone),
    ]);

    const [goalshqContext, repeatCarryoverTasks] = await Promise.all([
        fetchGoalshqContext(userId, goals),
        fetchRepeatCarryoverTasks(userId),
    ]);

    return {
        user,
        timezone,
        goals,
        projects,
        metrics,
        goalshqContext,
        repeatCarryoverTasks,
    };
}

function buildContextSummary({
    user,
    timezone,
    goals,
    projects,
    metrics,
    goalshqContext,
    repeatCarryoverTasks,
}) {
    const now = moment().tz(timezone);
    const dateStr = now.format('dddd, MMMM D, YYYY');
    const timeStr = now.format('h:mm A z');

    const lines = [];

    lines.push(`# User Context`);
    lines.push(`Date: ${dateStr} | Time: ${timeStr} | Timezone: ${timezone}`);
    if (user.ai_profile) {
        lines.push('');
        lines.push(`## About This User`);
        lines.push(user.ai_profile);
    }
    lines.push('');

    // Goals
    const goalSettingsByGoalId = goalshqContext?.goalSettingsByGoalId;
    lines.push(`## Active Goals (${goals.length})`);
    if (goals.length === 0) {
        lines.push('No active goals set.');
    } else {
        goals.forEach((g) => {
            const area = g.Area ? ` [${g.Area.name}]` : '';
            const horizon = g.horizon ? ` (${g.horizon})` : '';
            const target = g.target_date ? ` — target: ${g.target_date}` : '';
            const settings = goalSettingsByGoalId?.get(g.id);
            const eh = settings?.cached_execution_health;
            const oh = settings?.metrics_enabled
                ? settings?.cached_outcome_health
                : null;
            const parts = [];
            if (eh && eh !== 'no_data') parts.push(`exec ${eh}`);
            if (oh && oh !== 'no_data') parts.push(`outcome ${oh}`);
            const health = parts.length ? ` [${parts.join(', ')}]` : '';
            lines.push(`- "${g.title}"${area}${horizon}${target}${health}`);
            if (g.why) lines.push(`  Why: ${g.why}`);
        });
    }
    lines.push('');

    // Strategy & Key Results (GoalsHQ) — capped, context-budget guarded
    if (goalshqContext && goalshqContext.strategyDetails.length > 0) {
        const goalTitleById = new Map(goals.map((g) => [g.id, g.title]));
        const { strategyDetails } = goalshqContext;
        lines.push(`## Strategy & Key Results (top ${strategyDetails.length})`);
        strategyDetails.forEach(({ strategy, keyResults, milestones }) => {
            const goalTitle = goalTitleById.get(strategy.goal_id);
            const goalRef = goalTitle ? ` → Goal: "${goalTitle}"` : '';
            const health =
                strategy.cached_health && strategy.cached_health !== 'no_data'
                    ? ` [${strategy.cached_health}]`
                    : '';
            const percent =
                strategy.cached_percent != null
                    ? ` (avg ${Math.round(strategy.cached_percent)}% of linked projects)`
                    : '';
            lines.push(
                `- Strategy "${strategy.name}" — grouping${percent}${health}${goalRef}`
            );
            keyResults.slice(0, 2).forEach((kr) => {
                const pct = keyResultPercent(kr);
                const pctStr = pct != null ? ` (${Math.round(pct)}%)` : '';
                lines.push(
                    `  KR: ${kr.name} — ${kr.current_value}/${kr.target_value}${kr.unit ? ` ${kr.unit}` : ''}${pctStr}`
                );
            });
            milestones.slice(0, 2).forEach((m) => {
                const due = m.target_date ? ` (target: ${m.target_date})` : '';
                lines.push(`  Milestone: ${m.title} [${m.status}]${due}`);
            });
        });
        lines.push('');
    }

    // Projects
    lines.push(`## Active Projects (${projects.length})`);
    if (projects.length === 0) {
        lines.push('No active projects.');
    } else {
        projects.forEach((p) => {
            const area = p.Area ? ` [${p.Area.name}]` : '';
            const goal = p.Goal ? ` → Goal: "${p.Goal.title}"` : '';
            const priority = PRIORITY_LABELS[p.priority] || 'none';
            const due = p.due_date_at
                ? ` | due: ${moment(p.due_date_at).format('MMM D')}`
                : '';
            lines.push(
                `- "${p.name}" [${p.status}] [priority: ${priority}]${area}${goal}${due}`
            );
        });
    }
    lines.push('');

    // Task metrics
    lines.push(`## Today's Task Breakdown`);
    lines.push(`- Total open tasks: ${metrics.total_open_tasks}`);
    lines.push(
        `- Tasks pending over a month: ${metrics.tasks_pending_over_month}`
    );
    lines.push(`- In progress: ${metrics.tasks_in_progress_count}`);
    lines.push(`- Planned for today: ${metrics.today_plan_tasks_count}`);
    lines.push(`- Due today: ${metrics.tasks_due_today_count}`);
    lines.push(`- Overdue: ${(metrics.tasks_overdue || []).length}`);
    lines.push(`- Completed today: ${metrics.tasks_completed_today_count}`);
    lines.push('');

    // Weekly trend
    if (metrics.weekly_completions && metrics.weekly_completions.length > 0) {
        const weeklyStr = metrics.weekly_completions
            .map((d) => `${d.dayName}: ${d.count}`)
            .join(', ');
        lines.push(`## Weekly Completion Trend`);
        lines.push(weeklyStr);
        lines.push('');
    }

    // Overdue tasks (up to 5)
    const overdueTasks = metrics.tasks_overdue || [];
    if (overdueTasks.length > 0) {
        lines.push(
            `## Overdue Tasks (showing ${Math.min(5, overdueTasks.length)} of ${overdueTasks.length})`
        );
        overdueTasks.slice(0, 5).forEach((t) => {
            const daysAgo = t.due_date
                ? moment().diff(moment(t.due_date), 'days')
                : null;
            const overStr = daysAgo !== null ? ` (${daysAgo}d overdue)` : '';
            const project = t.Project?.name
                ? ` [Project: "${t.Project.name}"]`
                : '';
            lines.push(
                `- "${t.name}"${project}${overStr} [${PRIORITY_LABELS[t.priority] || 'no priority'}]`
            );
        });
        lines.push('');
    }

    // Tasks that keep getting rescheduled (Phase D carryover history)
    if (repeatCarryoverTasks && repeatCarryoverTasks.length > 0) {
        lines.push(`## Keeps Getting Postponed`);
        repeatCarryoverTasks.forEach((t) => {
            lines.push(`- "${t.name}" — carried over ${t.count}x`);
        });
        lines.push('');
    }

    // In-progress tasks (up to 5)
    const inProgressTasks = metrics.tasks_in_progress || [];
    if (inProgressTasks.length > 0) {
        lines.push(`## Currently In Progress`);
        inProgressTasks.slice(0, 5).forEach((t) => {
            const project = t.Project?.name
                ? ` [Project: "${t.Project.name}"]`
                : '';
            lines.push(
                `- "${t.name}"${project} [${PRIORITY_LABELS[t.priority] || 'no priority'}]`
            );
        });
        lines.push('');
    }

    // Planned for today (up to 5)
    const plannedTasks = metrics.today_plan_tasks || [];
    if (plannedTasks.length > 0) {
        lines.push(`## Planned for Today`);
        plannedTasks.slice(0, 5).forEach((t) => {
            const project = t.Project?.name
                ? ` [Project: "${t.Project.name}"]`
                : '';
            lines.push(
                `- "${t.name}"${project} [${STATUS_LABELS[t.status] || t.status}] [${PRIORITY_LABELS[t.priority] || 'no priority'}]`
            );
        });
        lines.push('');
    }

    // Suggested tasks (up to 5)
    const suggestedTasks = metrics.suggested_tasks || [];
    if (suggestedTasks.length > 0) {
        lines.push(
            `## System-Suggested Tasks (top ${Math.min(5, suggestedTasks.length)})`
        );
        suggestedTasks.slice(0, 5).forEach((t) => {
            const project = t.Project?.name
                ? ` [Project: "${t.Project.name}"]`
                : '';
            lines.push(
                `- "${t.name}"${project} [${PRIORITY_LABELS[t.priority] || 'no priority'}]`
            );
        });
        lines.push('');
    }

    return lines.join('\n');
}

async function getCachedBrief(userId) {
    const user = await User.findByPk(userId, {
        attributes: ['ai_daily_brief', 'ai_daily_brief_date'],
    });
    if (!user || !user.ai_daily_brief) return null;
    return user.ai_daily_brief;
}

function buildEntityMaps({ metrics, projects, repeatCarryoverTasks }) {
    const taskMap = new Map();
    const projectMap = new Map();

    const allTasks = [
        ...(metrics.tasks_overdue || []),
        ...(metrics.tasks_in_progress || []),
        ...(metrics.today_plan_tasks || []),
        ...(metrics.suggested_tasks || []),
        ...(metrics.tasks_due_today || []),
        ...(repeatCarryoverTasks || []),
    ];

    allTasks.forEach((t) => {
        if (t.name && t.uid && !taskMap.has(t.name)) {
            taskMap.set(t.name, t.uid);
        }
    });

    projects.forEach((p) => {
        if (p.name && p.uid) {
            projectMap.set(p.name, p.uid);
        }
    });

    return { taskMap, projectMap };
}

async function generateDailyBrief(userId) {
    const context = await fetchUserContext(userId);
    const contextSummary = buildContextSummary(context);

    const systemPrompt = `You are a productivity assistant in Tududi. Return a daily brief as JSON. Keep every field very short — no full sentences, no filler words.

Return a JSON object with exactly this shape:
{
  "overview": "≤20 words. One honest pulse on momentum — what's progressing, what's stalling, relative to goals.",
  "focus": "≤10 words. The one most important task today. Include project name.",
  "priority_actions": [
    {
      "action": "Exact task name",
      "project": "Project name or null",
      "reason": "≤6 words — why this matters now.",
      "suggestion": "≤12 words. Guess what this task involves and give one motivating tip or next step. Be specific and human."
    }
  ],
  "watch_out": ["≤8 words. Name the at-risk task or project."]
}

Rules:
- overview: reference actual task/project/goal counts or patterns from the data; no filler
- priority_actions: exactly 3 items, ordered by importance
- suggestion: infer the task's nature from its name, then motivate — e.g. for "Write test cases" say "Start with the happy path, the rest will flow." Don't be generic.
- watch_out: 0–2 items; empty array [] if nothing urgent
- Plain text only — no markdown, no ** formatting
- Return only the JSON object, no other text`;

    const response = await callLLM({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: contextSummary },
        ],
        max_tokens: getMaxTokens('LLM_MAX_TOKENS_DAILY_BRIEF', 1500),
        ...getExtraBodyParams(),
        response_format: buildResponseFormat('daily_brief', {
            type: 'object',
            properties: {
                overview: { type: 'string' },
                focus: { type: 'string' },
                priority_actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            action: { type: 'string' },
                            project: { type: 'string' },
                            reason: { type: 'string' },
                            suggestion: { type: 'string' },
                        },
                        required: ['action', 'project', 'reason', 'suggestion'],
                        additionalProperties: false,
                    },
                },
                watch_out: { type: 'array', items: { type: 'string' } },
            },
            required: ['overview', 'focus', 'priority_actions', 'watch_out'],
            additionalProperties: false,
        }),
    });

    const raw = extractMessageContent(response.choices[0]?.message);
    console.log('[AI Assistant] raw response:', raw);
    let parsed;
    try {
        parsed = JSON.parse(extractJSON(raw));
    } catch {
        parsed = {
            focus: raw,
            priority_actions: [],
            goal_alignment: '',
            watch_out: [],
        };
    }
    console.log('[AI Assistant] parsed:', JSON.stringify(parsed));

    const { taskMap, projectMap } = buildEntityMaps(context);
    const rawActions = Array.isArray(parsed.priority_actions)
        ? parsed.priority_actions
        : [];
    const enrichedActions = rawActions.map((a) => {
        const project = a.project && a.project !== 'null' ? a.project : null;
        return {
            ...a,
            project,
            task_uid: a.action ? taskMap.get(a.action) || null : null,
            project_uid: project ? projectMap.get(project) || null : null,
        };
    });

    const brief = {
        overview: parsed.overview || '',
        focus: parsed.focus || '',
        priority_actions: enrichedActions,
        watch_out: Array.isArray(parsed.watch_out) ? parsed.watch_out : [],
        generated_at: new Date().toISOString(),
        model: response.model,
        usage: {
            prompt_tokens: response.usage?.prompt_tokens,
            completion_tokens: response.usage?.completion_tokens,
        },
    };

    await User.update(
        {
            ai_daily_brief: brief,
            ai_daily_brief_date: moment().format('YYYY-MM-DD'),
        },
        { where: { id: userId } }
    );

    return brief;
}

async function getCachedTaskInsights(taskUid, userId) {
    const { Task } = require('../../models');
    const task = await Task.findOne({
        where: { uid: taskUid, user_id: userId },
        attributes: ['ai_insights'],
    });
    if (!task || !task.ai_insights) return null;

    const stored = task.ai_insights;

    // Handle legacy nested format: { request, response, generated_at }
    if (stored.response && typeof stored.response === 'object') {
        return {
            ...stored.response,
            generated_at: stored.generated_at || null,
            dismissed: stored.dismissed || false,
        };
    }

    return stored;
}

async function updateTaskInsightsDismissed(taskUid, userId, dismissed) {
    const { Task } = require('../../models');
    const task = await Task.findOne({
        where: { uid: taskUid, user_id: userId },
        attributes: ['ai_insights'],
    });
    if (!task || !task.ai_insights) return null;

    const stored = task.ai_insights;

    // Normalise legacy nested format before patching
    let flat = stored;
    if (stored.response && typeof stored.response === 'object') {
        flat = {
            ...stored.response,
            generated_at: stored.generated_at || null,
        };
    }

    const updated = { ...flat, dismissed };
    await Task.update(
        { ai_insights: updated },
        { where: { uid: taskUid, user_id: userId } }
    );
    return updated;
}

async function generateTaskInsights(taskContext, userId) {
    const {
        taskUid,
        taskName,
        taskNote,
        taskStatus,
        taskPriority,
        taskDueDate,
        taskTags,
        subtaskCount,
        projectName,
        projectDescription,
        projectStatus,
        projectGoal,
        projectArea,
    } = taskContext;

    const lines = [];
    lines.push(`Task: "${taskName}"`);
    lines.push(`Status: ${STATUS_LABELS[taskStatus] || taskStatus}`);
    lines.push(`Priority: ${PRIORITY_LABELS[taskPriority] || 'none'}`);
    if (taskDueDate) lines.push(`Due: ${taskDueDate}`);
    if (taskTags && taskTags.length > 0)
        lines.push(`Tags: ${taskTags.join(', ')}`);
    if (subtaskCount > 0) lines.push(`Subtasks: ${subtaskCount}`);
    if (taskNote) lines.push(`Notes: ${taskNote.slice(0, 300)}`);
    if (projectName) {
        lines.push(`Project: "${projectName}" [${projectStatus || 'active'}]`);
        if (projectArea) lines.push(`Area: ${projectArea}`);
        if (projectGoal) lines.push(`Goal: ${projectGoal}`);
        if (projectDescription)
            lines.push(
                `Project description: ${projectDescription.slice(0, 200)}`
            );
    }

    const systemPrompt = `You are a productivity assistant in Tududi. A user is viewing a task and needs real, specific help — not a paraphrase of the task name. Use the task name, project, tags, and notes to infer what this work actually involves, then give guidance that would only apply to THIS specific task.

LANGUAGE RULE: Detect the language of the task name and write every text field of your JSON response in that same language. If the task name is in Greek, respond in Greek. If in Spanish, respond in Spanish. If in English, respond in English. Never mix languages.

CRITICAL RULE: Never echo the task name back as your insight. If the task is "Write deployment procedures", your insight must explain what deployment procedures typically cover, what makes them hard, what done looks like — not just "this involves writing deployment procedures."

Return a JSON object with exactly this shape:
{
  "insight": "3–4 sentences. Explain what this work actually involves at a domain level — what specifically needs to be researched, written, built, or decided. Describe what a good final deliverable looks like. Call out non-obvious scope or complexity a beginner would miss.",
  "next_step": "2–3 sentences. Name the single most concrete first action. Give a real example — e.g. 'Open a blank doc and write the heading: Environment Requirements. List the 3 things someone would need installed before they can deploy.' Don't say 'start by planning' or 'gather requirements'.",
  "breakdown": [
    "Concrete action phrase specific to this task (not generic)",
    "Next concrete action phrase",
    "Next concrete action phrase",
    "Final concrete action phrase (optional)"
  ],
  "links": [
    { "label": "Short display name", "url": "https://example.com/specific-page" }
  ],
  "watch_out": "1–2 sentences. Name a real, specific risk that applies to THIS task — a dependency, an assumption that could be wrong, or something that commonly causes this kind of task to fail or get stuck. Or null if genuinely nothing to flag."
}

EXAMPLE of BAD output (too generic — never do this):
{
  "insight": "Creating detailed steps for software deployment.",
  "next_step": "Draft an outline of key deployment steps.",
  "breakdown": ["Plan the steps", "Write the document", "Review it"],
  "links": [],
  "watch_out": "Avoid last-minute changes."
}

EXAMPLE of GOOD output for task "Write deployment procedures" in project "E-commerce platform":
{
  "insight": "Deployment procedures for an e-commerce platform need to cover the full release lifecycle: pre-deploy checks, the exact sequence of commands to push code and run migrations, how to verify the deploy succeeded, and a rollback plan if something breaks. Done means a team member with no prior context could follow the doc and deploy successfully without asking questions. The tricky part is usually capturing the implicit knowledge that lives in people's heads — things like 'always restart the worker queue after migrations' or 'check the Stripe webhook endpoint is still pointed at prod'.",
  "next_step": "Open a doc and write a section called 'Pre-deployment checklist' first — this is usually the most forgotten part. List things like: feature flags off, migrations tested on staging, cache warmed, CDN purge queued. Once the checklist exists, the rest of the doc almost writes itself.",
  "breakdown": ["List all environments and who can deploy to each", "Document pre-deploy checklist (migrations, flags, dependencies)", "Write step-by-step deploy commands with expected output", "Add rollback procedure with exact revert steps", "Include post-deploy smoke tests to confirm success"],
  "links": [
    { "label": "GitHub Actions: Deploy", "url": "https://docs.github.com/en/actions/deployment/about-deployments/about-continuous-deployment" },
    { "label": "12-Factor App", "url": "https://12factor.net/build-release-run" }
  ],
  "watch_out": "If this project has database migrations, the deploy order matters — running migrations before or after the code deploy can break things in production for a few seconds. Make sure the doc specifies the exact order and whether the app needs to be in maintenance mode during the migration."
}

EXAMPLE of GOOD output for task "Plan museum visits in Paris" in project "Europe Trip 2024":
{
  "insight": "Planning Paris museum visits means deciding which of the city's 130+ museums fit your interests, then sequencing them geographically to avoid wasting half a day on the Métro. The Louvre alone needs 3–4 hours minimum — most people underestimate it and leave feeling rushed. 'Done' looks like a day-by-day schedule with museum names, opening hours, pre-booked ticket links, and nearby lunch spots to bridge visits.",
  "next_step": "Start with the Paris Museum Pass — it covers 50+ museums with no queue and saves money if you visit more than 2–3 major sites. Go to parismuseumpass.fr, check which museums are included, and decide whether a 2-day or 4-day pass fits your itinerary before booking anything else.",
  "breakdown": ["Pick top 5–8 museums based on interests (art, history, science)", "Check which are covered by the Paris Museum Pass", "Group museums by arrondissement to plan walking routes", "Book timed-entry tickets for Louvre and Versailles (sell out weeks ahead)", "Build a day-by-day schedule with opening hours and travel time"],
  "links": [
    { "label": "Louvre — Book tickets", "url": "https://www.louvre.fr/en/visit/tickets-passes" },
    { "label": "Musée d'Orsay", "url": "https://www.musee-orsay.fr/en/visit/practical-information/opening-times-and-admission-prices" },
    { "label": "Paris Museum Pass", "url": "https://www.parismuseumpass.fr/en" }
  ],
  "watch_out": "The Louvre and Palace of Versailles require timed-entry tickets booked weeks in advance during summer — walking up on the day almost always means turning back. Book these two first before planning the rest of the itinerary around them."
}

Rules:
- breakdown: 3–5 items, ordered by sequence, specific to THIS task
- links: 2–3 items. Prefer SPECIFIC, DIRECT links to the actual resources implied by this task — official websites of the museums/places/tools/docs mentioned, not generic homepages. Examples of good specificity: for "Plan museum visits in Paris" → link directly to https://www.louvre.fr/en, https://www.musee-orsay.fr/en, https://www.parismuseumpass.fr; for "Research flights to Tokyo" → https://www.google.com/travel/flights, https://www.skyscanner.com; for "Fix React useEffect bug" → https://react.dev/reference/react/useEffect. Use the exact official URL you know for this specific institution or tool. If you only know the root domain and not the specific page, use the root (e.g. https://www.centrepompidou.fr). Empty array [] only if no useful links genuinely apply.
- Plain text only in text fields — no markdown, no ** formatting
- Always reference the actual task name, project name, or tags in your response
- Return only the JSON object, no other text`;

    const response = await callLLM({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: lines.join('\n') },
        ],
        max_tokens: getMaxTokens('LLM_MAX_TOKENS_TASK_INSIGHTS', 1000),
        ...getExtraBodyParams(),
        response_format: buildResponseFormat('task_insights', {
            type: 'object',
            properties: {
                insight: { type: 'string' },
                next_step: { type: 'string' },
                breakdown: { type: 'array', items: { type: 'string' } },
                links: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            url: { type: 'string' },
                        },
                        required: ['label', 'url'],
                        additionalProperties: false,
                    },
                },
                watch_out: { type: ['string', 'null'] },
            },
            required: [
                'insight',
                'next_step',
                'breakdown',
                'links',
                'watch_out',
            ],
            additionalProperties: false,
        }),
    });

    const raw = extractMessageContent(response.choices[0]?.message);
    let parsed;
    try {
        parsed = JSON.parse(extractJSON(raw));
    } catch {
        parsed = {};
    }

    const rawLinks = Array.isArray(parsed.links) ? parsed.links : [];
    const links = rawLinks
        .filter(
            (l) =>
                l &&
                typeof l.label === 'string' &&
                typeof l.url === 'string' &&
                /^https?:\/\/.+/.test(l.url)
        )
        .slice(0, 3);

    const result = {
        insight: parsed.insight || '',
        next_step: parsed.next_step || '',
        breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown : [],
        links,
        watch_out: parsed.watch_out || null,
        generated_at: new Date().toISOString(),
        dismissed: false,
    };

    if (taskUid && userId) {
        const { Task } = require('../../models');
        await Task.update(
            { ai_insights: result },
            { where: { uid: taskUid, user_id: userId } }
        );
    }

    return result;
}

async function getCachedProjectInsights(projectUid, userId) {
    const { Project } = require('../../models');
    const project = await Project.findOne({
        where: { uid: projectUid, user_id: userId },
        attributes: ['ai_insights'],
    });
    if (!project || !project.ai_insights) return null;
    return project.ai_insights;
}

async function updateProjectInsightsDismissed(projectUid, userId, dismissed) {
    const { Project } = require('../../models');
    const project = await Project.findOne({
        where: { uid: projectUid, user_id: userId },
        attributes: ['ai_insights'],
    });
    if (!project || !project.ai_insights) return null;

    const updated = { ...project.ai_insights, dismissed };
    await Project.update(
        { ai_insights: updated },
        { where: { uid: projectUid, user_id: userId } }
    );
    return updated;
}

async function generateProjectInsights(projectContext, userId) {
    const {
        projectUid,
        projectName,
        projectDescription,
        projectStatus,
        projectPriority,
        projectDueDate,
        projectGoal,
        projectArea,
        totalTasks,
        openTasks,
        completedTasks,
        inProgressTasks,
        overdueTaskCount,
    } = projectContext;

    const lines = [];
    lines.push(`Project: "${projectName}"`);
    lines.push(`Status: ${projectStatus || 'not_started'}`);
    if (projectPriority !== undefined && projectPriority !== null) {
        lines.push(`Priority: ${PRIORITY_LABELS[projectPriority] || 'none'}`);
    }
    if (projectDueDate) lines.push(`Due: ${projectDueDate}`);
    if (projectArea) lines.push(`Area: ${projectArea}`);
    if (projectGoal) lines.push(`Goal: ${projectGoal}`);
    if (projectDescription)
        lines.push(`Description: ${projectDescription.slice(0, 300)}`);
    lines.push(
        `Tasks: ${totalTasks || 0} total, ${openTasks || 0} open, ${completedTasks || 0} completed, ${inProgressTasks || 0} in progress`
    );
    if (overdueTaskCount > 0) lines.push(`Overdue tasks: ${overdueTaskCount}`);

    const systemPrompt = `You are a productivity assistant in Tududi. A user is viewing a project and needs specific, actionable guidance — not generic advice. Use the project name, description, status, and task data to infer what this project is actually about, then give insights that only apply to THIS specific project.

CRITICAL RULE: Never just echo back the project name or status. Give real domain-level analysis.

Return a JSON object with exactly this shape:
{
  "insight": "3–4 sentences. Explain what this project is actually about at a domain level — what the work involves, what success looks like, and the current state based on the task data. Call out non-obvious scope or complexity.",
  "next_action": "2–3 sentences. Name the single most concrete next action to advance this project right now. Be specific — reference what kind of task should be created or worked on, based on the project's domain. Don't say 'add more tasks' or 'keep working'.",
  "health": "1–2 sentences. Give an honest assessment of project health based on the task numbers and due date. Is it on track, stalled, behind, or healthy? Reference actual numbers where relevant.",
  "watch_out": "1–2 sentences. Name a real, specific risk that applies to THIS project — a dependency, an assumption, something commonly causing this kind of project to stall. Or null if genuinely nothing to flag."
}

Rules:
- Plain text only — no markdown, no ** formatting
- Always reference the actual project name, domain, or task data in your response
- health must reference actual numbers if available
- watch_out should be null (JSON null) if there's no meaningful risk to flag
- Return only the JSON object, no other text`;

    const response = await callLLM({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: lines.join('\n') },
        ],
        max_tokens: getMaxTokens('LLM_MAX_TOKENS_PROJECT_INSIGHTS', 600),
        ...getExtraBodyParams(),
        response_format: buildResponseFormat('project_insights', {
            type: 'object',
            properties: {
                insight: { type: 'string' },
                next_action: { type: 'string' },
                health: { type: 'string' },
                watch_out: { type: ['string', 'null'] },
            },
            required: ['insight', 'next_action', 'health', 'watch_out'],
            additionalProperties: false,
        }),
    });

    const raw = extractMessageContent(response.choices[0]?.message);
    let parsed;
    try {
        parsed = JSON.parse(extractJSON(raw));
    } catch {
        parsed = {};
    }

    const result = {
        insight: parsed.insight || '',
        next_action: parsed.next_action || '',
        health: parsed.health || '',
        watch_out: parsed.watch_out || null,
        generated_at: new Date().toISOString(),
        dismissed: false,
    };

    if (projectUid && userId) {
        const { Project } = require('../../models');
        await Project.update(
            { ai_insights: result },
            { where: { uid: projectUid, user_id: userId } }
        );
    }

    return result;
}

/**
 * Short narrative for a GoalsHQ report (Goal / Strategy / Project). Returns
 * null if the LLM chain is unavailable or errors — the caller falls back to a
 * templated static summary.
 */
async function generateGoalshqReportNarrative({
    meta,
    krs,
    milestones,
    records,
}) {
    if (!isAIConfigured()) return null;
    const lines = [];
    lines.push(
        `Entity: ${meta.title} — execution ${meta.execution ?? '—'}%` +
            (meta.outcome == null ? '' : `, outcome ${meta.outcome}%`)
    );
    for (const k of (krs || []).slice(0, 8)) {
        lines.push(
            `KR: ${k.name} ${k.current}/${k.target}${k.unit ? ' ' + k.unit : ''}`
        );
    }
    for (const m of (milestones || []).slice(0, 8)) {
        lines.push(
            `Milestone: ${m.title} [${m.status}]${m.target_date ? ' due ' + m.target_date : ''}`
        );
    }
    for (const r of (records || []).slice(0, 20)) {
        lines.push(
            `Record ${r.date}: ${r.title}${r.amount != null ? ' (' + r.amount + ')' : ''}${r.body ? ' — ' + r.body : ''}`
        );
    }
    try {
        const response = await callLLM({
            messages: [
                {
                    role: 'system',
                    content:
                        'You write a 3-4 sentence progress narrative for a goal/strategy/project. Say what moved, what is at risk, and one concrete next focus. No preamble, no markdown headers.',
                },
                { role: 'user', content: lines.join('\n') },
            ],
            temperature: 0.4,
            max_tokens: 220,
        });
        const text = extractMessageContent(response.choices[0]?.message);
        return text ? text.trim() : null;
    } catch {
        return null;
    }
}

module.exports = {
    isAIConfigured,
    isConfigured: isAIConfigured,
    generateGoalshqReportNarrative,
    getProviderChainSummary,
    generateDailyBrief,
    getCachedBrief,
    generateTaskInsights,
    getCachedTaskInsights,
    updateTaskInsightsDismissed,
    generateProjectInsights,
    getCachedProjectInsights,
    updateProjectInsightsDismissed,
};
