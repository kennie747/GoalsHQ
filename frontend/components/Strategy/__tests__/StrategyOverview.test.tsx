import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import StrategyOverview from '../StrategyOverview';
import { GoalSummary } from '../../../entities/Goal';
import { Strategy } from '../../../entities/Strategy';
import { fetchStrategies } from '../../../utils/goalsHqService';

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
    fetchStrategies: jest.fn(),
}));
jest.mock('../StrategyModal', () => () => null);

const mockedFetchStrategies = fetchStrategies as jest.Mock;

let goalSummaries: GoalSummary[] = [];
const loadGoalSummaries = jest.fn();

jest.mock('../../../store/useStore', () => ({
    useStore: (selector: any) =>
        selector({
            strategiesStore: {
                get goalSummaries() {
                    return goalSummaries;
                },
                loadGoalSummaries,
            },
        }),
}));

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
        uid: 'strat-1',
        name: 'Real Estate',
        description: null,
        color: null,
        status: 'active',
        metrics_editable: true,
        sort_order: 0,
        goal: { uid: 'goal-1', title: 'To make my first million dollars' },
        summary: { percent: 49, health: 'at_risk', source: 'avg' },
        projects: [],
        project_counts: { total: 3 },
        key_results: [],
        milestones: [],
        trend: [],
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
        area: null,
        settings: null,
        execution_percent: 42,
        execution_health: 'on_track',
        outcome_percent: null,
        outcome_health: 'no_data',
        projects_count: 3,
        tasks_count: 6,
        strategies: [],
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
        goalSummaries = [makeGoal()];
    });

    it('groups strategies under their goal card', async () => {
        mockedFetchStrategies.mockResolvedValue([makeStrategy()]);
        renderPage();
        expect(await screen.findByText('Real Estate')).toBeInTheDocument();
        expect(
            screen.getByText('To make my first million dollars')
        ).toBeInTheDocument();
    });

    it('lists goal-less strategies under "Unassigned strategies"', async () => {
        mockedFetchStrategies.mockResolvedValue([
            makeStrategy({ uid: 's2', name: 'Content Engine', goal: null }),
        ]);
        renderPage();
        expect(
            await screen.findByText('Unassigned strategies')
        ).toBeInTheDocument();
        expect(screen.getByText('Content Engine')).toBeInTheDocument();
    });

    it('shows an empty state when there are no strategies at all', async () => {
        mockedFetchStrategies.mockResolvedValue([]);
        renderPage();
        await waitFor(() => expect(mockedFetchStrategies).toHaveBeenCalled());
        expect(
            await screen.findByText(/group the projects that belong together/i)
        ).toBeInTheDocument();
    });
});
