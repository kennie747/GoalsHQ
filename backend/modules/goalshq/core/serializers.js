'use strict';

/**
 * Manual response assembly (no Sequelize `include` — see ADR-0001). Every
 * serializer returns a plain object with `uid`s, never raw PKs.
 */

function num(v) {
    return v == null ? null : Number(v);
}

function serializeSettings(settings) {
    if (!settings) return null;
    return {
        progress_mode: settings.progress_mode,
        importance: settings.importance,
        weight_by_priority: settings.weight_by_priority,
        start_date: settings.start_date,
        manual_percent: num(settings.manual_percent),
        percent: num(settings.cached_percent),
        health: settings.cached_health || 'no_data',
        computed_at: settings.cached_computed_at,
    };
}

function serializeStrategy(strategy, extra = {}) {
    return {
        uid: strategy.uid,
        name: strategy.name,
        description: strategy.description,
        kind: strategy.kind,
        status: strategy.status,
        horizon_label: strategy.horizon_label,
        start_date: strategy.start_date,
        target_date: strategy.target_date,
        importance: strategy.importance,
        progress_mode: strategy.progress_mode,
        weight_by_priority: strategy.weight_by_priority,
        manual_percent: num(strategy.manual_percent),
        sort_order: strategy.sort_order,
        percent: num(strategy.cached_percent),
        health: strategy.cached_health || 'no_data',
        computed_at: strategy.cached_computed_at,
        created_at: strategy.created_at,
        updated_at: strategy.updated_at,
        ...extra,
    };
}

function serializeKeyResult(kr) {
    return {
        uid: kr.uid,
        parent_type: kr.parent_type,
        name: kr.name,
        unit: kr.unit,
        direction: kr.direction,
        auto_source: kr.auto_source,
        baseline_value: num(kr.baseline_value),
        target_value: num(kr.target_value),
        current_value: num(kr.current_value),
        sort_order: kr.sort_order,
    };
}

function serializeMilestone(m) {
    return {
        uid: m.uid,
        parent_type: m.parent_type,
        title: m.title,
        target_date: m.target_date,
        target_value: num(m.target_value),
        status: m.status,
        achieved_at: m.achieved_at,
        sort_order: m.sort_order,
    };
}

function serializeSnapshot(s) {
    return {
        date: s.snapshot_date,
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
        percent: percent == null ? null : Number(percent),
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
        percent: settings ? num(settings.cached_percent) : null,
        health: settings ? settings.cached_health || 'no_data' : 'no_data',
        projects_count: projectsCount,
        tasks_count: tasksCount,
        strategies: (strategies || []).map((s) => ({
            uid: s.uid,
            name: s.name,
            kind: s.kind,
            status: s.status,
            importance: s.importance,
            percent: num(s.cached_percent),
            health: s.cached_health || 'no_data',
            project_uids: projectUidsByStrategy.get(s.id) || [],
            projects: projectsByStrategy.get(s.id) || [],
        })),
    };
}

module.exports = {
    serializeSettings,
    serializeStrategy,
    serializeKeyResult,
    serializeMilestone,
    serializeSnapshot,
    serializeProjectRef,
    serializeGoalSummary,
};
