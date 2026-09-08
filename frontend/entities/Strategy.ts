import { GoalshqHealth } from './GoalSettings';
import { KeyResult } from './KeyResult';
import { Milestone } from './Milestone';
import { ProgressSnapshot } from './ProgressSnapshot';

export type StrategyStatus = 'active' | 'paused' | 'achieved' | 'dropped';

/** A project linked to a strategy, with its own execution %. */
export interface StrategyProjectRef {
    uid: string;
    name: string;
    status: string;
    priority: number | string | null;
    color: string | null;
    execution_percent: number | null;
    metrics_enabled?: boolean;
    outcome_percent?: number | null;
}

export interface StrategyProjectCounts {
    total: number;
    [status: string]: number;
}

/** The grouping summary = plain average of the linked projects' execution %. */
export interface StrategySummary {
    percent: number | null;
    health: GoalshqHealth;
    source: string;
    computed_at?: string | null;
}

export interface Strategy {
    uid: string;
    name: string;
    description: string | null;
    color: string | null;
    status: StrategyStatus;
    metrics_editable: boolean;
    sort_order: number;
    goal: { uid: string; title: string } | null;
    summary: StrategySummary;
    projects: StrategyProjectRef[];
    project_counts: StrategyProjectCounts | null;
    key_results: KeyResult[];
    milestones: Milestone[];
    trend: ProgressSnapshot[];
    created_at?: string;
    updated_at?: string;
}

/** Slim strategy shape embedded inside a GoalSummary. */
export interface GoalStrategySummary {
    uid: string;
    name: string;
    color: string | null;
    status: StrategyStatus;
    summary: { percent: number | null; health: GoalshqHealth };
    /** uids of projects linked to this strategy. */
    project_uids: string[];
    /** name+uid pairs, so the overview can link to them by name. */
    projects: { uid: string; name: string }[];
}
