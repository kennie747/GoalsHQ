import { ParentType } from './GoalSettings';

export type KeyResultDirection = 'increase' | 'decrease' | 'maintain';
export type KeyResultAutoSource =
    | 'manual'
    | 'tasks_done_count'
    | 'record_sum'
    | 'record_count'
    | 'child_kr_sum';

export interface KeyResult {
    uid: string;
    parent_type: ParentType;
    name: string;
    unit: string | null;
    direction: KeyResultDirection;
    auto_source: KeyResultAutoSource;
    baseline_value: number;
    target_value: number;
    current_value: number;
    sort_order: number;
    // KR tree (Part 2) — present once propagation exists.
    parent_kr_uid?: string | null;
    is_rollup?: boolean;
    children?: string[];
    coverage?: { child_target_sum: number; target: number; gap: number } | null;
}
