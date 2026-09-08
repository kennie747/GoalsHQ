export interface RecordAttachment {
    uid: string;
    original_filename: string;
    mime_type: string;
    file_size: number;
    file_url: string;
}

export interface GoalshqRecord {
    uid: string;
    parent_type: 'goal' | 'strategy' | 'project';
    record_date: string;
    title: string;
    category: string | null;
    amount: number | null;
    unit: string | null;
    status: string | null;
    counts_toward_kr_uid: string | null;
    evidence_url: string | null;
    task_id: number | null;
    note_id: number | null;
    body: string | null;
    attachments: RecordAttachment[];
    created_at?: string;
    updated_at?: string;
}

export type RecordTemplate = 'ledger' | 'build' | 'register';

export interface RecordInput {
    title?: string;
    record_date?: string;
    category?: string | null;
    amount?: number | null;
    unit?: string | null;
    status?: string | null;
    counts_toward_kr_uid?: string | null;
    evidence_url?: string | null;
    task_uid?: string | null;
    body?: string | null;
}

export interface KeyResultEntry {
    uid: string;
    entry_date: string;
    value: number;
    note: string | null;
    created_at?: string;
}
