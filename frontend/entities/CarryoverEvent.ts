export type CarryoverClassification = 'resurface' | 'reschedule' | 'drop';
export type CarryoverSource = 'auto' | 'user_override';

export interface CarryoverEvent {
    id: number;
    task_uid: string | null;
    task_name: string | null;
    occurred_on: string;
    classification: CarryoverClassification;
    previous_due_date: string | null;
    new_due_date: string | null;
    source: CarryoverSource;
    reviewed_at: string | null;
}
