export interface ProgressSnapshot {
    date: string;
    kind?: 'execution' | 'outcome';
    percent: number | null;
    health: string;
    source: string;
}
