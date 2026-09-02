/**
 * GoalsHQ entity types. Kept in one file (rather than one-per-entity) to
 * minimise the number of new files and keep the add-on's merge surface small —
 * see docs/goalshq/adr/0001-isolation-architecture.md.
 */

export type GoalshqHealth = 'on_track' | 'at_risk' | 'off_track' | 'no_data';

export type GoalProgressMode =
    | 'rollup_strategies'
    | 'rollup_projects'
    | 'rollup_tasks'
    | 'metric'
    | 'milestones'
    | 'manual';

export type StrategyProgressMode = Exclude<
    GoalProgressMode,
    'rollup_strategies'
>;

export type StrategyKind = 'primary' | 'secondary' | 'experiment';
export type StrategyStatus = 'active' | 'paused' | 'achieved' | 'dropped';
export type KeyResultDirection = 'increase' | 'decrease' | 'maintain';
export type MilestoneStatus = 'pending' | 'achieved' | 'missed';
export type ParentType = 'goal' | 'strategy';

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

export interface ProjectRef {
    uid: string;
    name: string;
    status: string;
    priority: number | null;
    color: string | null;
    percent: number | null;
}

export interface KeyResult {
    uid: string;
    parent_type: ParentType;
    name: string;
    unit: string | null;
    direction: KeyResultDirection;
    baseline_value: number;
    target_value: number;
    current_value: number;
    sort_order: number;
}

export interface Milestone {
    uid: string;
    parent_type: ParentType;
    title: string;
    target_date: string | null;
    target_value: number | null;
    status: MilestoneStatus;
    achieved_at: string | null;
    sort_order: number;
}

export interface ProgressSnapshot {
    date: string;
    percent: number | null;
    health: string;
    source: string;
}

export interface Strategy {
    uid: string;
    name: string;
    description: string | null;
    kind: StrategyKind;
    status: StrategyStatus;
    horizon_label: string | null;
    start_date: string | null;
    target_date: string | null;
    importance: number;
    progress_mode: StrategyProgressMode;
    weight_by_priority: boolean;
    manual_percent: number | null;
    sort_order: number;
    percent: number | null;
    health: GoalshqHealth;
    computed_at: string | null;
    created_at?: string;
    updated_at?: string;
    projects?: ProjectRef[];
    key_results?: KeyResult[];
    milestones?: Milestone[];
    trend?: ProgressSnapshot[];
}

export interface GoalStrategySummary {
    uid: string;
    name: string;
    kind: StrategyKind;
    status: StrategyStatus;
    importance: number;
    percent: number | null;
    health: GoalshqHealth;
}

export interface GoalSummary {
    uid: string;
    title: string;
    why: string | null;
    status: string;
    horizon: string;
    target_date: string | null;
    color: string | null;
    area: { uid: string; name: string; color: string | null } | null;
    settings: GoalSettings | null;
    percent: number | null;
    health: GoalshqHealth;
    strategies: GoalStrategySummary[];
}

export interface GoalDetail {
    uid: string;
    title: string;
    why: string | null;
    status: string;
    horizon: string;
    target_date: string | null;
    color: string | null;
    settings: GoalSettings;
    percent: number | null;
    health: GoalshqHealth;
    strategies: Strategy[];
    key_results: KeyResult[];
    milestones: Milestone[];
    direct_projects: ProjectRef[];
    trend: ProgressSnapshot[];
}
