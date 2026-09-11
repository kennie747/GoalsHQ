'use strict';

/**
 * Per-entity report assembly (Goal / Strategy / Project). Quantitative panels
 * from KRs / records / tasks + a qualitative narrative (AI via the ai-assistant
 * provider chain, with a templated static fallback).
 */

const { Op } = require('sequelize');
const {
    Goal,
    Project,
    GoalshqStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqKeyResultEntry,
    GoalshqMilestone,
    GoalshqRecord,
} = require('../../../models');
const { recordBreakdown } = require('./aggregate');
const math = require('./progress-math');

function periodStart(period) {
    const now = new Date();
    if (period === 'all') return null;
    const days = period === 'quarter' ? 92 : 30;
    return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

async function entityMeta(parentType, parentId) {
    if (parentType === 'goal') {
        const goal = await Goal.findByPk(parentId);
        const settings = await GoalshqGoalSettings.findOne({
            where: { goal_id: parentId },
        });
        return {
            title: goal ? goal.title : 'Goal',
            execution: settings ? settings.cached_execution_percent : null,
            executionHealth: settings
                ? settings.cached_execution_health
                : 'no_data',
            outcome:
                settings && settings.metrics_enabled
                    ? settings.cached_outcome_percent
                    : null,
            outcomeHealth:
                settings && settings.metrics_enabled
                    ? settings.cached_outcome_health
                    : 'no_data',
        };
    }
    if (parentType === 'project') {
        const project = await Project.findByPk(parentId);
        const settings = await GoalshqProjectSettings.findOne({
            where: { project_id: parentId },
        });
        return {
            title: project ? project.name : 'Project',
            execution: settings ? settings.cached_execution_percent : null,
            executionHealth: settings
                ? settings.cached_execution_health
                : 'no_data',
            outcome:
                settings && settings.metrics_enabled
                    ? settings.cached_outcome_percent
                    : null,
            outcomeHealth:
                settings && settings.metrics_enabled
                    ? settings.cached_outcome_health
                    : 'no_data',
        };
    }
    const strat = await GoalshqStrategy.findByPk(parentId);
    return {
        title: strat ? strat.name : 'Strategy',
        execution: strat ? strat.cached_percent : null,
        executionHealth: strat ? strat.cached_health : 'no_data',
        outcome: null,
        outcomeHealth: 'no_data',
    };
}

function staticNarrative(meta, krs, records) {
    const bits = [];
    bits.push(
        `${meta.title}: execution ${meta.execution == null ? '—' : Math.round(meta.execution) + '%'}` +
            (meta.outcome == null
                ? ''
                : `, outcome ${Math.round(meta.outcome)}%`) +
            `.`
    );
    const behind = krs.filter(
        (kr) =>
            math.keyResultPercent(kr) != null && math.keyResultPercent(kr) < 50
    );
    if (behind.length) {
        bits.push(`Behind target: ${behind.map((k) => k.name).join(', ')}.`);
    }
    if (records.length) {
        bits.push(`${records.length} record(s) logged this period.`);
    }
    return bits.join(' ');
}

async function assemble(userId, parentType, parentId, opts = {}) {
    const from = periodStart(opts.period);
    const [meta, krs, milestones, records] = await Promise.all([
        entityMeta(parentType, parentId),
        GoalshqKeyResult.findAll({
            where: { parent_type: parentType, parent_id: parentId },
            order: [['sort_order', 'ASC']],
        }),
        GoalshqMilestone.findAll({
            where: { parent_type: parentType, parent_id: parentId },
            order: [['target_date', 'ASC']],
        }),
        GoalshqRecord.findAll({
            where: {
                parent_type: parentType,
                parent_id: parentId,
                ...(from ? { record_date: { [Op.gte]: from } } : {}),
            },
            order: [['record_date', 'ASC']],
        }),
    ]);

    const krIds = krs.map((k) => k.id);
    const entries = krIds.length
        ? await GoalshqKeyResultEntry.findAll({
              where: { key_result_id: { [Op.in]: krIds } },
              order: [['entry_date', 'ASC']],
          })
        : [];
    const entriesByKr = new Map();
    for (const e of entries) {
        const list = entriesByKr.get(e.key_result_id) || [];
        list.push({ date: e.entry_date, value: Number(e.value) });
        entriesByKr.set(e.key_result_id, list);
    }

    // cumulative amount over time
    let running = 0;
    const cumulative = records
        .filter((r) => r.amount != null)
        .map((r) => {
            running += Number(r.amount);
            return { date: r.record_date, value: running };
        });

    const [byCategory, byStatus] = await Promise.all([
        recordBreakdown(parentType, parentId, 'category'),
        recordBreakdown(parentType, parentId, 'status'),
    ]);

    let narrative = staticNarrative(meta, krs, records);
    let narrativeSource = 'static';
    if (opts.withNarrative) {
        try {
            const ai = require('../../ai-assistant/service');
            if (ai.isConfigured && ai.isConfigured()) {
                const text = await ai.generateGoalshqReportNarrative({
                    userId,
                    meta,
                    krs: krs.map((k) => ({
                        name: k.name,
                        current: Number(k.current_value),
                        target: Number(k.target_value),
                        unit: k.unit,
                    })),
                    milestones: milestones.map((m) => ({
                        title: m.title,
                        status: m.status,
                        target_date: m.target_date,
                    })),
                    records: records.map((r) => ({
                        date: r.record_date,
                        title: r.title,
                        amount: r.amount,
                        body: r.body,
                    })),
                });
                if (text) {
                    narrative = text;
                    narrativeSource = 'ai';
                }
            }
        } catch (e) {
            // fall back to the static narrative
        }
    }

    return {
        title: meta.title,
        period: opts.period || '30d',
        quantitative: {
            execution_percent:
                meta.execution == null ? null : Number(meta.execution),
            execution_health: meta.executionHealth || 'no_data',
            outcome_percent: meta.outcome == null ? null : Number(meta.outcome),
            outcome_health: meta.outcomeHealth || 'no_data',
            key_results: krs.map((k) => ({
                name: k.name,
                unit: k.unit,
                current_value: Number(k.current_value),
                target_value: Number(k.target_value),
                percent: math.keyResultPercent(k),
                history: entriesByKr.get(k.id) || [],
            })),
            milestones: milestones.map((m) => ({
                title: m.title,
                status: m.status,
                target_date: m.target_date,
            })),
            cumulative_amount: cumulative,
            by_category: byCategory,
            by_status: byStatus,
            record_count: records.length,
        },
        qualitative: {
            narrative,
            narrative_source: narrativeSource,
            notes: records
                .filter((r) => r.body)
                .map((r) => ({
                    date: r.record_date,
                    title: r.title,
                    body: r.body,
                })),
        },
    };
}

module.exports = { assemble };
