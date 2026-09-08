import { GoalshqHealth } from './GoalSettings';

export interface ReportKr {
    name: string;
    unit: string | null;
    current_value: number;
    target_value: number;
    percent: number | null;
    history: { date: string; value: number }[];
}

export interface GoalshqReport {
    title: string;
    period: string;
    quantitative: {
        execution_percent: number | null;
        execution_health: GoalshqHealth;
        outcome_percent: number | null;
        outcome_health: GoalshqHealth;
        key_results: ReportKr[];
        milestones: {
            title: string;
            status: string;
            target_date: string | null;
        }[];
        cumulative_amount: { date: string; value: number }[];
        by_category: { key: string; sum: number; count: number }[];
        by_status: { key: string; sum: number; count: number }[];
        record_count: number;
    };
    qualitative: {
        narrative: string;
        narrative_source: 'ai' | 'static';
        notes: { date: string; title: string; body: string }[];
    };
}
