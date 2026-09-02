/**
 * GoalsHQ API client. Self-contained (pattern: goalsService.ts) — CSRF on every
 * mutation, session cookie on every request.
 */

import { handleAuthResponse, getPostHeadersWithCsrf } from './authUtils';
import { getApiPath } from '../config/paths';
import { getCsrfToken } from './csrfService';
import {
    GoalSummary,
    GoalDetail,
    GoalSettings,
    Strategy,
    KeyResult,
    Milestone,
    ParentType,
} from '../entities/GoalsHq';

async function getJson<T>(path: string, errorMsg: string): Promise<T> {
    const res = await fetch(getApiPath(`goalshq/${path}`), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(res, errorMsg);
    return res.json();
}

async function mutate<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    errorMsg: string
): Promise<T | undefined> {
    const headers =
        method === 'DELETE'
            ? {
                  Accept: 'application/json',
                  'x-csrf-token': await getCsrfToken(),
              }
            : await getPostHeadersWithCsrf();
    const res = await fetch(getApiPath(`goalshq/${path}`), {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    await handleAuthResponse(res, errorMsg);
    if (res.status === 204) return undefined;
    return res.json();
}

export const fetchGoalshqConfig = async (): Promise<{ enabled: boolean }> => {
    try {
        return await getJson('config', 'Failed to load GoalsHQ config.');
    } catch {
        return { enabled: false };
    }
};

export const fetchGoalshqGoals = async (): Promise<GoalSummary[]> =>
    (await getJson<{ goals: GoalSummary[] }>('goals', 'Failed to load goals.'))
        .goals;

export const fetchGoalshqGoal = async (uid: string): Promise<GoalDetail> =>
    (
        await getJson<{ goal: GoalDetail }>(
            `goals/${uid}`,
            'Failed to load goal.'
        )
    ).goal;

export const updateGoalSettings = async (
    uid: string,
    data: Partial<GoalSettings>
): Promise<GoalSettings> =>
    (
        (await mutate<{ settings: GoalSettings }>(
            'PATCH',
            `goals/${uid}/settings`,
            data,
            'Failed to update goal settings.'
        )) as { settings: GoalSettings }
    ).settings;

export const recomputeGoal = async (uid: string): Promise<GoalDetail> =>
    (
        (await mutate<{ goal: GoalDetail }>(
            'POST',
            `goals/${uid}/recompute`,
            {},
            'Failed to recompute goal.'
        )) as { goal: GoalDetail }
    ).goal;

export const fetchStrategies = async (goalUid: string): Promise<Strategy[]> =>
    (
        await getJson<{ strategies: Strategy[] }>(
            `goals/${goalUid}/strategies`,
            'Failed to load strategies.'
        )
    ).strategies;

export const createStrategy = async (
    goalUid: string,
    data: Partial<Strategy>
): Promise<Strategy> =>
    (
        (await mutate<{ strategy: Strategy }>(
            'POST',
            `goals/${goalUid}/strategies`,
            data,
            'Failed to create strategy.'
        )) as { strategy: Strategy }
    ).strategy;

export const fetchStrategy = async (uid: string): Promise<Strategy> =>
    (
        await getJson<{ strategy: Strategy }>(
            `strategies/${uid}`,
            'Failed to load strategy.'
        )
    ).strategy;

export const updateStrategy = async (
    uid: string,
    data: Partial<Strategy>
): Promise<Strategy> =>
    (
        (await mutate<{ strategy: Strategy }>(
            'PATCH',
            `strategies/${uid}`,
            data,
            'Failed to update strategy.'
        )) as { strategy: Strategy }
    ).strategy;

export const deleteStrategy = async (uid: string): Promise<void> => {
    await mutate(
        'DELETE',
        `strategies/${uid}`,
        undefined,
        'Failed to delete strategy.'
    );
};

export const linkProject = async (
    strategyUid: string,
    projectUid: string,
    weight?: number
): Promise<Strategy> =>
    (
        (await mutate<{ strategy: Strategy }>(
            'POST',
            `strategies/${strategyUid}/projects`,
            { project_uid: projectUid, weight },
            'Failed to link project.'
        )) as { strategy: Strategy }
    ).strategy;

export const unlinkProject = async (
    strategyUid: string,
    projectUid: string
): Promise<Strategy> =>
    (
        (await mutate<{ strategy: Strategy }>(
            'DELETE',
            `strategies/${strategyUid}/projects/${projectUid}`,
            undefined,
            'Failed to unlink project.'
        )) as { strategy: Strategy }
    ).strategy;

export const recomputeStrategy = async (uid: string): Promise<Strategy> =>
    (
        (await mutate<{ strategy: Strategy }>(
            'POST',
            `strategies/${uid}/recompute`,
            {},
            'Failed to recompute strategy.'
        )) as { strategy: Strategy }
    ).strategy;

/* key results */

export const createKeyResult = async (
    parentType: ParentType,
    parentUid: string,
    data: Partial<KeyResult>
): Promise<KeyResult> =>
    (
        (await mutate<{ key_result: KeyResult }>(
            'POST',
            `${parentType}/${parentUid}/key-results`,
            data,
            'Failed to create key result.'
        )) as { key_result: KeyResult }
    ).key_result;

export const updateKeyResult = async (
    uid: string,
    data: Partial<KeyResult>
): Promise<KeyResult> =>
    (
        (await mutate<{ key_result: KeyResult }>(
            'PATCH',
            `key-results/${uid}`,
            data,
            'Failed to update key result.'
        )) as { key_result: KeyResult }
    ).key_result;

export const deleteKeyResult = async (uid: string): Promise<void> => {
    await mutate(
        'DELETE',
        `key-results/${uid}`,
        undefined,
        'Failed to delete key result.'
    );
};

/* milestones */

export const createMilestone = async (
    parentType: ParentType,
    parentUid: string,
    data: Partial<Milestone>
): Promise<Milestone> =>
    (
        (await mutate<{ milestone: Milestone }>(
            'POST',
            `${parentType}/${parentUid}/milestones`,
            data,
            'Failed to create milestone.'
        )) as { milestone: Milestone }
    ).milestone;

export const updateMilestone = async (
    uid: string,
    data: Partial<Milestone>
): Promise<Milestone> =>
    (
        (await mutate<{ milestone: Milestone }>(
            'PATCH',
            `milestones/${uid}`,
            data,
            'Failed to update milestone.'
        )) as { milestone: Milestone }
    ).milestone;

export const deleteMilestone = async (uid: string): Promise<void> => {
    await mutate(
        'DELETE',
        `milestones/${uid}`,
        undefined,
        'Failed to delete milestone.'
    );
};
