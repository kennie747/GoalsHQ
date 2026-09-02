/**
 * The only GoalsHQ frontend file coupled to tududi's own service / util
 * signatures. If upstream changes them, fix them here — see ADR-0001.
 */

import { fetchProjects } from '../../../utils/projectsService';
import { createUidSlug, extractUidFromSlug } from '../../../utils/slugUtils';

export interface PickableProject {
    uid: string;
    name: string;
    status: string;
}

export async function fetchActiveProjects(): Promise<PickableProject[]> {
    const projects = await fetchProjects('all', '');
    return (projects || [])
        .filter((p: any) => p && p.uid)
        .map((p: any) => ({ uid: p.uid, name: p.name, status: p.status }));
}

export function goalHqPath(uid: string, name: string): string {
    return `/goalshq/goal/${createUidSlug(uid, name)}`;
}

export function strategyHqPath(uid: string, name: string): string {
    return `/goalshq/strategy/${createUidSlug(uid, name)}`;
}

export function uidFromSlug(uidSlug: string | undefined): string {
    return extractUidFromSlug(uidSlug || '');
}
