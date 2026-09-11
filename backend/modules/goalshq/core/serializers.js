'use strict';

/**
 * Manual response assembly (no Sequelize `include` — see ADR-0001). Every
 * serializer returns a plain object with `uid`s, never raw PKs.
 */

function num(v) {
    return v == null ? null : Number(v);
}

/**
 * Goal / Project settings: always an execution number; an outcome number only
 * when `metrics_enabled`. Shown side by side, never blended.
 */
function serializeSettings(settings) {
    if (!settings) return null;
    return {
        metrics_enabled: !!settings.metrics_enabled,
        start_date: settings.start_date ?? null,
        manual_percent: num(settings.manual_percent),
        execution_percent: num(settings.cached_execution_percent),
        execution_health: settings.cached_execution_health || 'no_data',
        outcome_percent: settings.metrics_enabled
            ? num(settings.cached_outcome_percent)
            : null,
        outcome_health: settings.metrics_enabled
            ? settings.cached_outcome_health || 'no_data'
            : 'no_data',
        computed_at: settings.cached_computed_at,
    };
}

/**
 * A strategy: a grouping bucket. `summary` is the *grouping average* of its
 * linked projects' execution % — display-only, never a goal-rollup input.
 */
function serializeStrategy(strategy, extra = {}) {
    return {
        uid: strategy.uid,
        name: strategy.name,
        description: strategy.description,
        color: strategy.color || null,
        status: strategy.status,
        metrics_editable: strategy.metrics_editable !== false,
        sort_order: strategy.sort_order,
        summary: {
            percent: num(strategy.cached_percent),
            health: strategy.cached_health || 'no_data',
            source: 'avg of linked projects',
            computed_at: strategy.cached_computed_at,
        },
        created_at: strategy.created_at,
        updated_at: strategy.updated_at,
        // goal / projects / project_counts / key_results / milestones / trend
        // are attached by the caller via `extra`.
        goal: null,
        projects: [],
        project_counts: null,
        key_results: [],
        milestones: [],
        trend: [],
        ...extra,
    };
}

function serializeKeyResult(kr, extra = {}) {
    return {
        uid: kr.uid,
        parent_type: kr.parent_type,
        name: kr.name,
        unit: kr.unit,
        direction: kr.direction,
        auto_source: kr.auto_source,
        is_rollup: kr.auto_source === 'child_kr_sum',
        baseline_value: num(kr.baseline_value),
        target_value: num(kr.target_value),
        current_value: num(kr.current_value),
        sort_order: kr.sort_order,
        parent_kr_uid: null,
        children: [],
        coverage: null,
        entries: [],
        ...extra,
    };
}

function serializeKrEntry(e) {
    return {
        uid: e.uid,
        entry_date: e.entry_date,
        value: num(e.value),
        note: e.note,
        created_at: e.created_at,
    };
}

function serializeRecord(
    r,
    { attachments = [], countsTowardKrUid = null } = {}
) {
    return {
        uid: r.uid,
        parent_type: r.parent_type,
        record_date: r.record_date,
        title: r.title,
        category: r.category,
        amount: num(r.amount),
        unit: r.unit,
        status: r.status,
        counts_toward_kr_uid: countsTowardKrUid,
        evidence_url: r.evidence_url,
        task_id: r.task_id,
        note_id: r.note_id,
        body: r.body,
        attachments,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

function serializeMilestone(
    m,
    {
        taskUids = [],
        projectUids = [],
        autoKrUid = null,
        expandedTaskUid = null,
    } = {}
) {
    return {
        uid: m.uid,
        parent_type: m.parent_type,
        title: m.title,
        target_date: m.target_date,
        target_value: num(m.target_value),
        status: m.status,
        achieved_at: m.achieved_at,
        sort_order: m.sort_order,
        completion_mode: m.completion_mode || 'all',
        auto_kr_uid: autoKrUid,
        auto_kr_threshold: num(m.auto_kr_threshold),
        auto_achieved: !!m.auto_achieved,
        task_uids: taskUids,
        project_uids: projectUids,
        expanded_task_uid: expandedTaskUid,
    };
}

function serializeSnapshot(s) {
    return {
        date: s.snapshot_date,
        kind: s.kind || 'execution',
        percent: num(s.percent),
        health: s.health,
        source: s.source,
    };
}

function serializeProjectRef(project, percent) {
    return {
        uid: project.uid,
        name: project.name,
        status: project.status,
        priority: project.priority,
        color: project.color,
        execution_percent: percent == null ? null : Number(percent),
    };
}

/** A goal card for the dashboard list. */
function serializeGoalSummary(
    goal,
    settings,
    strategies,
    {
        projectUidsByStrategy = new Map(),
        projectsByStrategy = new Map(),
        projectsCount = null,
        tasksCount = null,
    } = {}
) {
    return {
        uid: goal.uid,
        title: goal.title,
        why: goal.why,
        status: goal.status,
        horizon: goal.horizon,
        target_date: goal.target_date,
        color: goal.color,
        area: goal.Area
            ? {
                  uid: goal.Area.uid,
                  name: goal.Area.name,
                  color: goal.Area.color,
              }
            : null,
        settings: serializeSettings(settings),
        execution_percent: settings
            ? num(settings.cached_execution_percent)
            : null,
        execution_health: settings
            ? settings.cached_execution_health || 'no_data'
            : 'no_data',
        outcome_percent:
            settings && settings.metrics_enabled
                ? num(settings.cached_outcome_percent)
                : null,
        outcome_health:
            settings && settings.metrics_enabled
                ? settings.cached_outcome_health || 'no_data'
                : 'no_data',
        projects_count: projectsCount,
        tasks_count: tasksCount,
        strategies: (strategies || []).map((s) => ({
            uid: s.uid,
            name: s.name,
            color: s.color || null,
            status: s.status,
            summary: {
                percent: num(s.cached_percent),
                health: s.cached_health || 'no_data',
            },
            project_uids: projectUidsByStrategy.get(s.id) || [],
            projects: projectsByStrategy.get(s.id) || [],
        })),
    };
}

module.exports = {
    serializeSettings,
    serializeStrategy,
    serializeKeyResult,
    serializeKrEntry,
    serializeRecord,
    serializeMilestone,
    serializeSnapshot,
    serializeProjectRef,
    serializeGoalSummary,
};
