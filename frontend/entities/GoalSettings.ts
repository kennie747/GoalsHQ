export type GoalshqHealth = 'on_track' | 'at_risk' | 'off_track' | 'no_data';

// A GoalsHQ key result / milestone can be attached to any of these tiers —
// Milestone never uses 'task' (a task already has a due_date/status), see
// docs/goalshq/adr/0002-first-class-integration.md, Phase A Follow-up AF3.
export type ParentType = 'goal' | 'strategy' | 'project' | 'task';

export type GoalProgressMode =
    | 'rollup_strategies'
    | 'rollup_projects'
    | 'rollup_tasks'
    | 'metric'
    | 'milestones'
    | 'manual';

export interface GoalSettings {
    progress_mode: GoalProgressMode;
    importance: number;
    weight_by_priority: boolean;
    start_date: string | null;
    manual_percent: number | null;
    percent: number | null;
    health: GoalshqHealth;
    computed_at: string | null;
}
