import { handleAuthResponse } from './authUtils';
import { getApiPath } from '../config/paths';
import { getCsrfToken } from './csrfService';
import {
    CarryoverEvent,
    CarryoverClassification,
} from '../entities/CarryoverEvent';

export const fetchCarryoverEvents = async (): Promise<CarryoverEvent[]> => {
    const response = await fetch(getApiPath('tasks/carryover'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load carryover events.');
    const data = await response.json();
    return data.events;
};

export const fetchCarryoverHistory = async (): Promise<CarryoverEvent[]> => {
    const response = await fetch(getApiPath('tasks/carryover/history'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    await handleAuthResponse(response, 'Failed to load carryover history.');
    const data = await response.json();
    return data.events;
};

export const acceptCarryoverEvent = async (
    id: number
): Promise<CarryoverEvent> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`tasks/carryover/${id}/accept`),
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
    await handleAuthResponse(response, 'Failed to accept carryover event.');
    const data = await response.json();
    return data.event;
};

export const overrideCarryoverEvent = async (
    id: number,
    override: {
        classification: CarryoverClassification;
        new_due_date?: string | null;
    }
): Promise<CarryoverEvent> => {
    const token = await getCsrfToken();
    const response = await fetch(
        getApiPath(`tasks/carryover/${id}/override`),
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-csrf-token': token,
            },
            body: JSON.stringify(override),
        }
    );
    await handleAuthResponse(response, 'Failed to override carryover event.');
    const data = await response.json();
    return data.event;
};
