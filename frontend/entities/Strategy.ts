import { GoalProgressMode, GoalshqHealth } from './GoalSettings';
import { KeyResult } from './KeyResult';
import { Milestone } from './Milestone';
import { ProgressSnapshot } from './ProgressSnapshot';
import { ProjectRef } from './Project';

export type StrategyProgressMode = Exclude<
    GoalProgressMode,
    'rollup_strategies'
>;

export type StrategyKind = 'primary' | 'secondary' | 'experiment';
export type StrategyStatus = 'active' | 'paused' | 'achieved' | 'dropped';

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

/** Slim strategy shape embedded inside a GoalSummary. */
export interface GoalStrategySummary {
    uid: string;
    name: string;
    kind: StrategyKind;
    status: StrategyStatus;
    importance: number;
    percent: number | null;
    health: GoalshqHealth;
    /** uids of projects linked to this strategy — powers Strategy-level (not just Goal-level) attribution. */
    project_uids: string[];
    /** name+uid pairs for the same projects, so the Strategy overview can link to them by name. */
    projects: { uid: string; name: string }[];
}
