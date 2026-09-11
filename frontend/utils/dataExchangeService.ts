import { handleAuthResponse } from './authUtils';
import { getApiPath } from '../config/paths';
import { getCsrfToken } from './csrfService';

export type ExchangeFormat = 'xlsx' | 'csv';
export type ImportMode = 'merge' | 'sync';

export interface ResourceColumn {
    header: string;
    kind: string;
    required: boolean;
    identity: boolean;
    enumValues: string[] | null;
    note: string | null;
}

export interface ResourceDescriptor {
    key: string;
    sheet: string;
    dependsOn: string[];
    supportsTags: boolean;
    columns: ResourceColumn[];
}

export interface ResourcesResponse {
    resources: ResourceDescriptor[];
    enums: Record<string, string[]>;
}

export interface PlanError {
    sheet: string;
    row: number;
    column: string;
    message: string;
}

export interface ResourcePlan {
    key: string;
    created: number;
    updated: number;
    unchanged: number;
    errors: PlanError[];
    deleted: { uid: string; label: string }[];
    pendingDeletes: number;
}

export interface PlanResult {
    mode: ImportMode;
    committed: boolean;
    resources: Record<string, ResourcePlan>;
    totals: {
        created: number;
        updated: number;
        unchanged: number;
        errors: number;
        pendingDeletes: number;
    };
}

export interface ImportOptions {
    mode?: ImportMode;
    syncScopes?: string[];
    syncDelete?: 'archive' | 'destroy';
    confirmDeletes?: number;
}

export interface DataExchangeJob {
    uid: string;
    direction: 'export' | 'import';
    format: ExchangeFormat;
    scopes: string[];
    mode: ImportMode | null;
    filename: string | null;
    status: 'success' | 'error';
    stats: PlanResult['totals'] | null;
    error_message: string | null;
    created_at: string;
}

const listResources = async (): Promise<ResourcesResponse> => {
    const response = await fetch(getApiPath('data-exchange/resources'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(
        response,
        'Failed to load data exchange metadata.'
    );
    return response.json();
};

const triggerDownload = async (url: string) => {
    const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/octet-stream, application/json' },
    });
    await handleAuthResponse(response, 'Download failed.');

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : 'tududi-export';

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
};

const buildQuery = (format: ExchangeFormat, scopes: string[], extra = '') => {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('scopes', scopes.length ? scopes.join(',') : 'all');
    return `${params.toString()}${extra}`;
};

const downloadTemplate = (
    format: ExchangeFormat,
    scopes: string[],
    populate = false
): Promise<void> =>
    triggerDownload(
        getApiPath(
            `data-exchange/template?${buildQuery(
                format,
                scopes,
                populate ? '&populate=true' : ''
            )}`
        )
    );

const downloadExport = (
    format: ExchangeFormat,
    scopes: string[]
): Promise<void> =>
    triggerDownload(
        getApiPath(`data-exchange/export?${buildQuery(format, scopes)}`)
    );

const submit = async (
    endpoint: 'preview' | 'commit',
    file: File,
    format: ExchangeFormat,
    scopes: string[],
    options: ImportOptions
): Promise<PlanResult> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', format);
    formData.append('scopes', scopes.length ? scopes.join(',') : 'all');
    if (options.mode) formData.append('mode', options.mode);
    if (options.syncScopes?.length)
        formData.append('syncScopes', options.syncScopes.join(','));
    if (options.syncDelete) formData.append('syncDelete', options.syncDelete);
    if (options.confirmDeletes !== undefined)
        formData.append('confirmDeletes', String(options.confirmDeletes));

    const response = await fetch(getApiPath(`data-exchange/${endpoint}`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': await getCsrfToken() },
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `${endpoint} failed`);
    }
    return response.json();
};

const previewImport = (
    file: File,
    format: ExchangeFormat,
    scopes: string[],
    options: ImportOptions = {}
) => submit('preview', file, format, scopes, options);

const commitImport = (
    file: File,
    format: ExchangeFormat,
    scopes: string[],
    options: ImportOptions = {}
) => submit('commit', file, format, scopes, options);

const listJobs = async (limit = 10): Promise<DataExchangeJob[]> => {
    const response = await fetch(
        getApiPath(`data-exchange/jobs?limit=${limit}`),
        { credentials: 'include', headers: { Accept: 'application/json' } }
    );
    await handleAuthResponse(response, 'Failed to load import/export history.');
    const data = await response.json();
    return data.jobs;
};

export const dataExchangeService = {
    listResources,
    downloadTemplate,
    downloadExport,
    previewImport,
    commitImport,
    listJobs,
};
