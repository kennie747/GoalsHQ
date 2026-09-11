import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CarryoverReview from '../CarryoverReview';
import {
    fetchCarryoverEvents,
    acceptCarryoverEvent,
    overrideCarryoverEvent,
} from '../../../utils/carryoverService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: any) =>
            typeof fallback === 'string' ? fallback : _key,
    }),
}));

jest.mock('../../../utils/carryoverService', () => ({
    fetchCarryoverEvents: jest.fn(),
    acceptCarryoverEvent: jest.fn(),
    overrideCarryoverEvent: jest.fn(),
}));

const mockedFetch = fetchCarryoverEvents as jest.Mock;
const mockedAccept = acceptCarryoverEvent as jest.Mock;
const mockedOverride = overrideCarryoverEvent as jest.Mock;

const baseEvent = {
    id: 1,
    task_uid: 'abc123',
    task_name: 'Stale orphan task',
    occurred_on: '2026-09-05',
    previous_due_date: '2026-08-16',
    new_due_date: null,
    source: 'auto' as const,
    reviewed_at: null,
};

describe('CarryoverReview', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders nothing while loading and nothing once loaded with an empty queue', async () => {
        mockedFetch.mockResolvedValue([]);

        const { container } = render(<CarryoverReview />);
        expect(container).toBeEmptyDOMElement();

        await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the fetch fails (fails silently)', async () => {
        mockedFetch.mockRejectedValue(new Error('network down'));

        const { container } = render(<CarryoverReview />);

        await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
        expect(container).toBeEmptyDOMElement();
    });

    it('renders a "drop" row with its explanation and no proposed date', async () => {
        mockedFetch.mockResolvedValue([
            { ...baseEvent, classification: 'drop' },
        ]);

        render(<CarryoverReview />);

        expect(
            await screen.findByText('Carried over from before (1)')
        ).toBeInTheDocument();
        expect(screen.getByText('Stale orphan task')).toBeInTheDocument();
        expect(
            screen.getByText(
                'No project/goal, overdue a while, low priority — safe to cancel?'
            )
        ).toBeInTheDocument();
        expect(screen.queryByText(/Proposed new due date/)).not.toBeInTheDocument();
    });

    it('renders a "reschedule" row with its proposed due date', async () => {
        mockedFetch.mockResolvedValue([
            {
                ...baseEvent,
                classification: 'reschedule',
                new_due_date: '2026-09-05',
            },
        ]);

        render(<CarryoverReview />);

        expect(await screen.findByText('Stale orphan task')).toBeInTheDocument();
        expect(
            screen.getByText(/Proposed new due date.*2026-09-05/)
        ).toBeInTheDocument();
    });

    it('renders a "resurface" row with its explanation', async () => {
        mockedFetch.mockResolvedValue([
            { ...baseEvent, classification: 'resurface' },
        ]);

        render(<CarryoverReview />);

        expect(await screen.findByText('Stale orphan task')).toBeInTheDocument();
        expect(
            screen.getByText(
                'This matters — surfacing it, not touching its due date.'
            )
        ).toBeInTheDocument();
    });

    it('accepting a row calls acceptCarryoverEvent and removes it from the list', async () => {
        const user = userEvent.setup();
        mockedFetch.mockResolvedValue([
            { ...baseEvent, classification: 'drop' },
        ]);
        mockedAccept.mockResolvedValue({
            ...baseEvent,
            classification: 'drop',
            reviewed_at: '2026-09-05T00:00:00Z',
        });

        render(<CarryoverReview />);

        const acceptButton = await screen.findByText('Accept');
        await user.click(acceptButton);

        await waitFor(() => expect(mockedAccept).toHaveBeenCalledWith(1));
        await waitFor(() =>
            expect(
                screen.queryByText('Carried over from before (1)')
            ).not.toBeInTheDocument()
        );
    });

    it('overriding a row opens the classification/date controls and applies the change', async () => {
        const user = userEvent.setup();
        mockedFetch.mockResolvedValue([
            { ...baseEvent, classification: 'drop' },
        ]);
        mockedOverride.mockResolvedValue({
            ...baseEvent,
            classification: 'reschedule',
            new_due_date: '2026-09-10',
            source: 'user_override',
        });

        render(<CarryoverReview />);

        const changeButton = await screen.findByText('Change instead');
        await user.click(changeButton);

        // classification select defaults to the event's own classification ("drop")
        const select = screen.getByRole('combobox');
        await user.selectOptions(select, 'reschedule');

        const dateInput = screen.getByDisplayValue(
            new Date().toISOString().slice(0, 10)
        );
        await user.clear(dateInput);
        await user.type(dateInput, '2026-09-10');

        await user.click(screen.getByText('Apply'));

        await waitFor(() =>
            expect(mockedOverride).toHaveBeenCalledWith(1, {
                classification: 'reschedule',
                new_due_date: '2026-09-10',
            })
        );
        await waitFor(() =>
            expect(
                screen.queryByText('Carried over from before (1)')
            ).not.toBeInTheDocument()
        );
    });

    it('overriding to a non-reschedule classification sends null new_due_date', async () => {
        const user = userEvent.setup();
        mockedFetch.mockResolvedValue([
            { ...baseEvent, classification: 'reschedule', new_due_date: '2026-09-05' },
        ]);
        mockedOverride.mockResolvedValue({
            ...baseEvent,
            classification: 'drop',
            new_due_date: null,
            source: 'user_override',
        });

        render(<CarryoverReview />);

        const changeButton = await screen.findByText('Change instead');
        await user.click(changeButton);

        const select = screen.getByRole('combobox');
        await user.selectOptions(select, 'drop');

        await user.click(screen.getByText('Apply'));

        await waitFor(() =>
            expect(mockedOverride).toHaveBeenCalledWith(1, {
                classification: 'drop',
                new_due_date: null,
            })
        );
    });

    it('renders multiple rows and only removes the one resolved', async () => {
        mockedFetch.mockResolvedValue([
            { ...baseEvent, id: 1, task_name: 'Task A', classification: 'drop' },
            { ...baseEvent, id: 2, task_name: 'Task B', classification: 'resurface' },
        ]);
        mockedAccept.mockResolvedValue({
            ...baseEvent,
            id: 1,
            classification: 'drop',
            reviewed_at: '2026-09-05T00:00:00Z',
        });

        const user = userEvent.setup();
        render(<CarryoverReview />);

        expect(
            await screen.findByText('Carried over from before (2)')
        ).toBeInTheDocument();

        const acceptButtons = screen.getAllByText('Accept');
        await user.click(acceptButtons[0]);

        await waitFor(() =>
            expect(
                screen.getByText('Carried over from before (1)')
            ).toBeInTheDocument()
        );
        expect(screen.getByText('Task B')).toBeInTheDocument();
        expect(screen.queryByText('Task A')).not.toBeInTheDocument();
    });
});
