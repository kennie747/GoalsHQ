import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import StrategyOverview from '../StrategyOverview';
import { GoalSummary } from '../../../entities/Goal';
import {
    updateStrategy,
    deleteStrategy,
    createStrategy,
} from '../../../utils/goalsHqService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: any, options?: Record<string, any>) => {
            const base = typeof fallback === 'string' ? fallback : _key;
            if (!options) return base;
            return Object.keys(options).reduce(
                (str, k) => str.replace(`{{${k}}}`, String(options[k])),
                base
            );
        },
    }),
}));

jest.mock('../../../utils/goalsHqService', () => ({
    updateStrategy: jest.fn(),
    deleteStrategy: jest.fn(),
    createStrategy: jest.fn(),
}));

const showSuccessToast = jest.fn();
const showErrorToast = jest.fn();
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({ showSuccessToast, showErrorToast }),
}));

const mockedUpdateStrategy = updateStrategy as jest.Mock;
const mockedDeleteStrategy = deleteStrategy as jest.Mock;
const mockedCreateStrategy = createStrategy as jest.Mock;

let goalSummaries: GoalSummary[] = [];
const loadGoalSummaries = jest.fn();

jest.mock('../../../store/useStore', () => ({
    useStore: (selector: any) =>
        selector({
            strategiesStore: {
                get goalSummaries() {
                    return goalSummaries;
                },
                isLoading: false,
                isError: false,
                hasLoaded: true,
                loadGoalSummaries,
            },
        }),
}));

function makeStrategy(overrides: Partial<GoalSummary['strategies'][number]> = {}) {
    return {
        uid: 'strat-1',
        name: 'Path S: Security Audit',
        kind: 'primary' as const,
        status: 'active' as const,
        importance: 4,
        percent: 25,
        health: 'at_risk' as const,
        project_uids: ['proj-a'],
        projects: [{ uid: 'proj-a', name: 'Dual Buyer Program' }],
        ...overrides,
    };
}

function makeGoal(overrides: Partial<GoalSummary> = {}): GoalSummary {
    return {
        uid: 'goal-1',
        title: 'To make my first million dollars',
        why: null,
        status: 'active',
        horizon: 'season',
        target_date: null,
        color: null,
        area: { uid: 'area-1', name: 'Finance', color: null },
        settings: null,
        percent: 42,
        health: 'on_track',
        projects_count: 2,
        tasks_count: 6,
        strategies: [makeStrategy()],
        ...overrides,
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <StrategyOverview />
        </MemoryRouter>
    );
}

describe('StrategyOverview', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        goalSummaries = [];
    });

    it('only renders a card for goals that have at least one strategy', () => {
        goalSummaries = [
            makeGoal({ uid: 'goal-1', title: 'Has Strategies' }),
            makeGoal({ uid: 'goal-2', title: 'No Strategies', strategies: [] }),
        ];

        renderPage();

        expect(screen.getByText('Has Strategies')).toBeInTheDocument();
        expect(screen.queryByText('No Strategies')).not.toBeInTheDocument();
    });

    it('shows the empty state when goals exist but none has a strategy', () => {
        goalSummaries = [makeGoal({ strategies: [] })];

        renderPage();

        expect(screen.getByText('No strategies yet')).toBeInTheDocument();
        expect(
            screen.getByText('Create Strategy')
        ).toBeInTheDocument();
    });

    it('creating a strategy from the empty state navigates to it', async () => {
        goalSummaries = [makeGoal({ strategies: [] })];
        mockedCreateStrategy.mockResolvedValue({
            uid: 'new-strat',
            name: 'First Strategy',
        });

        renderPage();
        await userEvent.type(
            screen.getByPlaceholderText('Strategy name'),
            'First Strategy'
        );
        await userEvent.click(screen.getByText('Create Strategy'));

        await waitFor(() =>
            expect(mockedCreateStrategy).toHaveBeenCalledWith('goal-1', {
                name: 'First Strategy',
            })
        );
    });

    it('expands a card in place to show its strategies and linked projects, without navigating', async () => {
        goalSummaries = [makeGoal()];
        renderPage();

        expect(
            screen.queryByText('Strategies for To make my first million dollars')
        ).not.toBeInTheDocument();

        await userEvent.click(
            screen.getByLabelText('Toggle strategies')
        );

        expect(
            screen.getByText('Strategies for To make my first million dollars')
        ).toBeInTheDocument();
        expect(screen.getByText('Path S: Security Audit')).toBeInTheDocument();
        expect(screen.getByText('Dual Buyer Program')).toBeInTheDocument();
    });

    it('hides paused/experimental strategies behind a toggle, active ones show by default', async () => {
        goalSummaries = [
            makeGoal({
                strategies: [
                    makeStrategy({ uid: 'active-1', name: 'Active Strategy' }),
                    makeStrategy({
                        uid: 'paused-1',
                        name: 'Paused Strategy',
                        status: 'paused',
                        projects: [],
                        project_uids: [],
                    }),
                ],
            }),
        ];
        renderPage();
        await userEvent.click(screen.getByLabelText('Toggle strategies'));

        expect(screen.getByText('Active Strategy')).toBeInTheDocument();
        expect(screen.queryByText('Paused Strategy')).not.toBeInTheDocument();

        await userEvent.click(
            screen.getByText('Show 1 paused/experimental strategies')
        );
        expect(screen.getByText('Paused Strategy')).toBeInTheDocument();
    });

    it('renames a strategy inline via the pencil icon', async () => {
        goalSummaries = [makeGoal()];
        mockedUpdateStrategy.mockResolvedValue({});
        renderPage();
        await userEvent.click(screen.getByLabelText('Toggle strategies'));

        await userEvent.click(screen.getByLabelText('Edit'));
        const input = screen.getByDisplayValue('Path S: Security Audit');
        await userEvent.clear(input);
        await userEvent.type(input, 'Renamed Strategy{Enter}');

        await waitFor(() =>
            expect(mockedUpdateStrategy).toHaveBeenCalledWith('strat-1', {
                name: 'Renamed Strategy',
            })
        );
        expect(screen.getByText('Renamed Strategy')).toBeInTheDocument();
    });

    it('deletes a strategy after confirming, and the card disappears once it was the last one', async () => {
        goalSummaries = [makeGoal()];
        mockedDeleteStrategy.mockResolvedValue(undefined);
        renderPage();
        await userEvent.click(screen.getByLabelText('Toggle strategies'));

        await userEvent.click(screen.getByLabelText('Delete'));
        expect(screen.getByText('Delete Strategy')).toBeInTheDocument();

        await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));

        await waitFor(() =>
            expect(mockedDeleteStrategy).toHaveBeenCalledWith('strat-1')
        );
        await waitFor(() =>
            expect(
                screen.queryByText('To make my first million dollars')
            ).not.toBeInTheDocument()
        );
    });

    it('renders the Area / Projects / Tasks stats footer', () => {
        goalSummaries = [makeGoal()];
        renderPage();

        expect(screen.getByText('Finance')).toBeInTheDocument();
        expect(screen.getByText('2 projects')).toBeInTheDocument();
        expect(screen.getByText('6 tasks')).toBeInTheDocument();
    });
});
