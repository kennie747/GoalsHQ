import { handleAuthResponse } from './authUtils';
import { getApiPath } from '../config/paths';
import { getCsrfToken } from './csrfService';
import { GoalSummary, GoalDetail } from '../entities/Goal';
import { GoalSettings, ParentType } from '../entities/GoalSettings';
import { Strategy } from '../entities/Strategy';
import { KeyResult } from '../entities/KeyResult';
import { Milestone } from '../entities/Milestone';

export const fetchGoalshqGoals = async (): Promise<GoalSummary[]> => {
    const response = await fetch(getApiPath('goalshq/goals'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load goals.');
    const data = await response.json();
    return data.goals;
};

export const fetchGoalshqGoal = async (uid: string): Promise<GoalDetail> => {
    const response = await fetch(getApiPath(`goalshq/goals/${uid}`), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load goal.');
    const data = await response.json();
    return data.goal;
};

export const updateGoalSettings = async (
    uid: string,
    settingsData: Partial<GoalSettings>
): Promise<GoalSettings> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/goals/${uid}/settings`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
        body: JSON.stringify(settingsData),
    });
    await handleAuthResponse(response, 'Failed to update goal settings.');
    const data = await response.json();
    return data.settings;
};

export const recomputeGoal = async (uid: string): Promise<GoalDetail> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/goals/${uid}/recompute`), {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
    });
    await handleAuthResponse(response, 'Failed to recompute goal.');
    const data = await response.json();
    return data.goal;
};

export const fetchStrategies = async (
    goalUid?: string
): Promise<Strategy[]> => {
    const path = goalUid
        ? `goalshq/goals/${goalUid}/strategies`
        : 'goalshq/strategies';
    const response = await fetch(getApiPath(path), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load strategies.');
    const data = await response.json();
    return data.strategies;
};

export interface StrategyInput {
    name?: string;
    description?: string | null;
    color?: string | null;
    status?: string;
    metrics_editable?: boolean;
    /** null clears the goal ("No Goal"); undefined leaves it unchanged. */
    goal_uid?: string | null;
    project_uids?: string[];
    sort_order?: number;
}

export const createStrategy = async (
    strategyData: StrategyInput
): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath('goalshq/strategies'), {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
        body: JSON.stringify(strategyData),
    });
    await handleAuthResponse(response, 'Failed to create strategy.');
    const data = await response.json();
    return data.strategy;
};

export const fetchStrategy = async (uid: string): Promise<Strategy> => {
    const response = await fetch(getApiPath(`goalshq/strategies/${uid}`), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load strategy.');
    const data = await response.json();
    return data.strategy;
};

export const updateStrategy = async (
    uid: string,
    strategyData: StrategyInput
): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/strategies/${uid}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
        body: JSON.stringify(strategyData),
    });
    await handleAuthResponse(response, 'Failed to update strategy.');
    const data = await response.json();
    return data.strategy;
};

export const deleteStrategy = async (uid: string): Promise<void> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/strategies/${uid}`), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'x-csrf-token': token,
        },
    });
    await handleAuthResponse(response, 'Failed to delete strategy.');
};

export const linkProject = async (
    strategyUid: string,
    projectUid: string
): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/strategies/${strategyUid}/projects`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify({ project_uid: projectUid }),
        }
    );
    await handleAuthResponse(response, 'Failed to link project.');
    const data = await response.json();
    return data.strategy;
};

/** Replace a strategy's whole project set (checkbox multi-select). */
export const setStrategyProjects = async (
    strategyUid: string,
    projectUids: string[]
): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/strategies/${strategyUid}/projects`),
        {
            method: 'PUT',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify({ project_uids: projectUids }),
        }
    );
    await handleAuthResponse(response, 'Failed to update strategy projects.');
    const data = await response.json();
    return data.strategy;
};

/** Replace a project's whole strategy set (from the Project modal). */
export const setProjectStrategies = async (
    projectUid: string,
    strategyUids: string[]
): Promise<void> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/projects/${projectUid}/strategies`),
        {
            method: 'PUT',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify({ strategy_uids: strategyUids }),
        }
    );
    await handleAuthResponse(response, 'Failed to update project strategies.');
};

export const unlinkProject = async (
    strategyUid: string,
    projectUid: string
): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/strategies/${strategyUid}/projects/${projectUid}`),
        {
            method: 'DELETE',
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                'x-csrf-token': token,
            },
        }
    );
    await handleAuthResponse(response, 'Failed to unlink project.');
    const data = await response.json();
    return data.strategy;
};

export const recomputeStrategy = async (uid: string): Promise<Strategy> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/strategies/${uid}/recompute`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
        }
    );
    await handleAuthResponse(response, 'Failed to recompute strategy.');
    const data = await response.json();
    return data.strategy;
};

/* key results */

export const createKeyResult = async (
    parentType: ParentType,
    parentUid: string,
    krData: Partial<KeyResult>
): Promise<KeyResult> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/${parentType}/${parentUid}/key-results`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify(krData),
        }
    );
    await handleAuthResponse(response, 'Failed to create key result.');
    const data = await response.json();
    return data.key_result;
};

export const updateKeyResult = async (
    uid: string,
    krData: Partial<KeyResult>
): Promise<KeyResult> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/key-results/${uid}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
        body: JSON.stringify(krData),
    });
    await handleAuthResponse(response, 'Failed to update key result.');
    const data = await response.json();
    return data.key_result;
};

export const deleteKeyResult = async (uid: string): Promise<void> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/key-results/${uid}`), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'x-csrf-token': token,
        },
    });
    await handleAuthResponse(response, 'Failed to delete key result.');
};

/* milestones */

export const createMilestone = async (
    parentType: ParentType,
    parentUid: string,
    milestoneData: Partial<Milestone>
): Promise<Milestone> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/${parentType}/${parentUid}/milestones`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify(milestoneData),
        }
    );
    await handleAuthResponse(response, 'Failed to create milestone.');
    const data = await response.json();
    return data.milestone;
};

export const updateMilestone = async (
    uid: string,
    milestoneData: Partial<Milestone>
): Promise<Milestone> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/milestones/${uid}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': token,
        },
        body: JSON.stringify(milestoneData),
    });
    await handleAuthResponse(response, 'Failed to update milestone.');
    const data = await response.json();
    return data.milestone;
};

export const deleteMilestone = async (uid: string): Promise<void> => {
    const token = await getCsrfToken();
    const response = await fetch(getApiPath(`goalshq/milestones/${uid}`), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'x-csrf-token': token,
        },
    });
    await handleAuthResponse(response, 'Failed to delete milestone.');
};

export interface ExpandedTask {
    uid: string;
    name: string;
    due_date: string | null;
}

export const expandMilestone = async (uid: string): Promise<ExpandedTask> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`goalshq/milestones/${uid}/expand`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
        }
    );
    await handleAuthResponse(
        response,
        'Failed to expand milestone into a task.'
    );
    const data = await response.json();
    return data.task;
};
