import { ParentType } from './GoalSettings';

export type KeyResultDirection = 'increase' | 'decrease' | 'maintain';
export type KeyResultAutoSource = 'manual' | 'tasks_done_count';

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
}
