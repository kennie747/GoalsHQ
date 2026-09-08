import { Area } from './Area';
import { Task } from './Task';
import { Project } from './Project';
import { GoalSettings, GoalshqHealth } from './GoalSettings';
import { GoalStrategySummary, Strategy } from './Strategy';
import { KeyResult } from './KeyResult';
import { Milestone } from './Milestone';
import { ProgressSnapshot } from './ProgressSnapshot';

export type GoalHorizon = 'season' | 'year';
export type GoalStatus = 'active' | 'achieved' | 'paused' | 'dropped';

export interface Goal {
    id?: number;
    uid?: string;
    area_id?: number | null;
    user_id?: number;
    title: string;
    why?: string | null;
    horizon: GoalHorizon;
    target_date?: string | null;
    status: GoalStatus;
    color?: string;
    created_at?: string;
    updated_at?: string;
    Area?: Area | null;
    Tasks?: Task[];
    Projects?: Project[];
}

/** GoalsHQ goal card for the dashboard list. */
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
    execution_percent: number | null;
    execution_health: GoalshqHealth;
    outcome_percent: number | null;
    outcome_health: GoalshqHealth;
    /** Distinct projects associated with this goal, directly or via any of its strategies. */
    projects_count: number;
    /** Tasks (including subtasks) attached directly to the goal or to any of its associated projects. */
    tasks_count: number;
    strategies: GoalStrategySummary[];
}

export interface GoalProjectRef {
    uid: string;
    name: string;
    status: string;
    priority: number | string | null;
    color: string | null;
    execution_percent: number | null;
    metrics_enabled?: boolean;
    outcome_percent?: number | null;
}

/** GoalsHQ goal detail page — settings, strategies (grouping), and projects. */
export interface GoalDetail {
    uid: string;
    title: string;
    why: string | null;
    status: string;
    horizon: string;
    target_date: string | null;
    color: string | null;
    settings: GoalSettings;
    execution_percent: number | null;
    execution_health: GoalshqHealth;
    outcome_percent: number | null;
    outcome_health: GoalshqHealth;
    strategies: Strategy[];
    key_results: KeyResult[];
    milestones: Milestone[];
    projects: GoalProjectRef[];
    trend: ProgressSnapshot[];
}
