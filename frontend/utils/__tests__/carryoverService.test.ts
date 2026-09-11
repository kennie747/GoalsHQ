import {
    fetchCarryoverEvents,
    acceptCarryoverEvent,
    overrideCarryoverEvent,
} from '../carryoverService';

jest.mock('../authUtils', () => ({
    handleAuthResponse: jest.fn(async (response: Response, message: string) => {
        if (!response.ok) throw new Error(message);
        return response;
    }),
}));

jest.mock('../csrfService', () => ({
    getCsrfToken: jest.fn(async () => 'test-csrf-token'),
}));

const jsonResponse = (status: number, body: unknown) =>
    ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    }) as Response;

describe('carryoverService', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('fetchCarryoverEvents', () => {
        it('returns the events array from a successful response', async () => {
            const events = [
                {
                    id: 1,
                    task_uid: 'abc',
                    task_name: 'Old task',
                    occurred_on: '2026-09-05',
                    classification: 'drop',
                    previous_due_date: '2026-08-16',
                    new_due_date: null,
                    source: 'auto',
                    reviewed_at: null,
                },
            ];
            global.fetch = jest
                .fn()
                .mockResolvedValue(jsonResponse(200, { events })) as jest.Mock;

            await expect(fetchCarryoverEvents()).resolves.toEqual(events);
        });

        it('rejects when the request fails', async () => {
            global.fetch = jest
                .fn()
                .mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' })) as jest.Mock;

            await expect(fetchCarryoverEvents()).rejects.toThrow(
                'Failed to load carryover events.'
            );
        });
    });

    describe('acceptCarryoverEvent', () => {
        it('posts to the accept endpoint and returns the updated event', async () => {
            const event = { id: 5, classification: 'drop', reviewed_at: '2026-09-05T00:00:00Z' };
            const fetchMock = jest
                .fn()
                .mockResolvedValue(jsonResponse(200, { event })) as jest.Mock;
            global.fetch = fetchMock;

            await expect(acceptCarryoverEvent(5)).resolves.toEqual(event);

            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('tasks/carryover/5/accept'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'x-csrf-token': 'test-csrf-token',
                    }),
                })
            );
        });

        it('rejects when the accept request fails', async () => {
            global.fetch = jest
                .fn()
                .mockResolvedValue(jsonResponse(400, { error: 'Already reviewed' })) as jest.Mock;

            await expect(acceptCarryoverEvent(5)).rejects.toThrow(
                'Failed to accept carryover event.'
            );
        });
    });

    describe('overrideCarryoverEvent', () => {
        it('posts the override body and returns the updated event', async () => {
            const event = {
                id: 7,
                classification: 'reschedule',
                new_due_date: '2026-09-10',
            };
            const fetchMock = jest
                .fn()
                .mockResolvedValue(jsonResponse(200, { event })) as jest.Mock;
            global.fetch = fetchMock;

            await expect(
                overrideCarryoverEvent(7, {
                    classification: 'reschedule',
                    new_due_date: '2026-09-10',
                })
            ).resolves.toEqual(event);

            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('tasks/carryover/7/override'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        classification: 'reschedule',
                        new_due_date: '2026-09-10',
                    }),
                })
            );
        });

        it('rejects when the override request fails', async () => {
            global.fetch = jest
                .fn()
                .mockResolvedValue(jsonResponse(400, { error: 'Invalid classification' })) as jest.Mock;

            await expect(
                overrideCarryoverEvent(7, { classification: 'drop', new_due_date: null })
            ).rejects.toThrow('Failed to override carryover event.');
        });
    });
});
