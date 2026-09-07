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
}
