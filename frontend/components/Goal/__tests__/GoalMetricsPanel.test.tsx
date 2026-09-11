import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import GoalMetricsPanel from '../GoalMetricsPanel';
import {
    fetchGoalshqGoal,
    updateGoalSettings,
} from '../../../utils/goalsHqService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any, opts?: any) =>
            typeof fb === 'string'
                ? fb.replace(
                      /\{\{(\w+)\}\}/g,
                      (_m: string, k: string) => opts?.[k] ?? ''
                  )
                : _k,
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    fetchGoalshqGoal: jest.fn(),
    updateGoalSettings: jest.fn(),
}));
jest.mock('../../Strategy/MetricsPanels', () => {
    const M = () => <div data-testid="metrics-panels" />;
    return M;
});
jest.mock('../../Strategy/RecordsPanel', () => {
    const M = () => <div data-testid="records-panel" />;
    return M;
});
jest.mock('../../Strategy/ReportTab', () => {
    const M = () => <div data-testid="report-tab" />;
    return M;
});
jest.mock('../../Strategy/StrategyModal', () => {
    const M = () => <div data-testid="strategy-modal" />;
    return M;
});

const mockFetch = fetchGoalshqGoal as jest.Mock;
const mockUpdate = updateGoalSettings as jest.Mock;

const goalDetail = (over: any = {}) => ({
    uid: 'g1',
    title: '$1M',
    why: null,
    status: 'active',
    horizon: 'year',
    target_date: null,
    color: null,
    settings: {
        metrics_enabled: false,
        start_date: null,
        manual_percent: null,
        execution_percent: 58,
        execution_health: 'at_risk',
        outcome_percent: 31,
        outcome_health: 'off_track',
        computed_at: null,
    },
    execution_percent: 58,
    execution_health: 'at_risk',
    outcome_percent: 31,
    outcome_health: 'off_track',
    key_results: [{ uid: 'kr1', name: 'Net profit' }],
    milestones: [{ uid: 'm1', title: 'First deal' }],
    trend: [],
    strategies: [
        {
            uid: 's1',
            name: 'Real Estate',
            color: '#2f9e6b',
            status: 'active',
            summary: { percent: 49, health: 'at_risk', source: 'avg' },
            projects: [
                { uid: 'p1', name: 'Rental acquisition', status: 'in_progress', execution_percent: 61 },
                { uid: 'p2', name: 'Flip One', status: 'planned', execution_percent: 34 },
            ],
        },
        {
            uid: 's2',
            name: 'Systems Security',
            color: '#3b6fd4',
            status: 'active',
            summary: { percent: 71, health: 'on_track', source: 'avg' },
            projects: [],
        },
    ],
    projects: [
        { uid: 'p1', name: 'Rental acquisition', status: 'in_progress', execution_percent: 61 },
        { uid: 'p2', name: 'Flip One', status: 'planned', execution_percent: 34 },
        { uid: 'p9', name: 'Direct model re-run', status: 'planned', execution_percent: 10 },
    ],
    ...over,
});

const renderPanel = () =>
    render(
        <MemoryRouter>
            <GoalMetricsPanel goalUid="g1" />
        </MemoryRouter>
    );

describe('GoalMetricsPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockResolvedValue(goalDetail());
        mockUpdate.mockResolvedValue({});
    });

    it('loads and shows the Execution view by default', async () => {
        renderPanel();
        expect(
            await screen.findByText('Execution', { selector: 'button' })
        ).toBeInTheDocument();
        expect(screen.getByText('58%')).toBeInTheDocument();
    });

    it('switches the L2 tabs to Records and Report', async () => {
        renderPanel();
        await screen.findByText('58%');
        await userEvent.click(screen.getByRole('button', { name: 'Records' }));
        expect(screen.getByTestId('records-panel')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Report' }));
        expect(screen.getByTestId('report-tab')).toBeInTheDocument();
    });

    it('Progress → Strategies expands a strategy to reveal its projects; Projects tab is flat', async () => {
        renderPanel();
        await screen.findByText('58%');
        await userEvent.click(
            screen.getByRole('button', { name: 'Strategies' })
        );
        // expanded by default → project rows visible
        expect(screen.getByText('Rental acquisition')).toBeInTheDocument();
        // ungrouped section
        expect(screen.getByText('Directly on the goal')).toBeInTheDocument();
        expect(screen.getByText('Direct model re-run')).toBeInTheDocument();

        // collapse the first strategy
        const chevrons = screen.getAllByRole('button', { name: 'Toggle' });
        await userEvent.click(chevrons[0]);
        expect(
            screen.queryByText('Rental acquisition')
        ).not.toBeInTheDocument();

        await userEvent.click(
            screen.getByRole('button', { name: 'Projects' })
        );
        expect(screen.getByText('Direct model re-run')).toBeInTheDocument();
    });

    it('toggling "Track outcome metrics" calls updateGoalSettings and reloads', async () => {
        renderPanel();
        await screen.findByText('58%');
        await userEvent.click(
            screen.getByLabelText(/Track outcome metrics/)
        );
        await waitFor(() =>
            expect(mockUpdate).toHaveBeenCalledWith('g1', {
                metrics_enabled: true,
            })
        );
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('renders "unavailable" when the fetch fails', async () => {
        mockFetch.mockRejectedValue(new Error('boom'));
        renderPanel();
        expect(
            await screen.findByText('Metrics are unavailable.')
        ).toBeInTheDocument();
    });
});
