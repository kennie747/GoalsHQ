export type GoalshqHealth = 'on_track' | 'at_risk' | 'off_track' | 'no_data';

// A GoalsHQ key result / milestone can be attached to any of these tiers —
// Milestone never uses 'task' (a task already has a due_date/status).
export type ParentType = 'goal' | 'strategy' | 'project' | 'task';

/**
 * Goal / Project settings. A goal always has an execution number (task/project
 * completion); it gets an outcome number (Key Results / Milestones) only when
 * `metrics_enabled` is on. Shown side by side, never blended.
 */
export interface GoalSettings {
    metrics_enabled: boolean;
    start_date: string | null;
    manual_percent: number | null;
    execution_percent: number | null;
    execution_health: GoalshqHealth;
    outcome_percent: number | null;
    outcome_health: GoalshqHealth;
    computed_at: string | null;
}
