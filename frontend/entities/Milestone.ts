import { ParentType } from './GoalSettings';

export type MilestoneStatus = 'pending' | 'achieved' | 'missed';

export interface Milestone {
    uid: string;
    parent_type: ParentType;
    title: string;
    target_date: string | null;
    target_value: number | null;
    status: MilestoneStatus;
    achieved_at: string | null;
    sort_order: number;
    // Auto-achieve triggers (Part 2)
    completion_mode?: 'all' | 'any';
    auto_kr_uid?: string | null;
    auto_kr_threshold?: number | null;
    auto_achieved?: boolean;
    task_uids?: string[];
}
