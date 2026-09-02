import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import GoalsHqDashboard from '../GoalsHqDashboard';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: any) =>
            typeof fallback === 'string'
                ? fallback
                : (fallback && fallback.defaultValue) || _key,
    }),
}));

jest.mock('../../../utils/goalsHqService', () => ({
    fetchGoalshqConfig: jest.fn().mockResolvedValue({ enabled: true }),
    fetchGoalshqGoals: jest.fn().mockResolvedValue([
        {
            uid: 'g1',
            title: 'One Million',
            why: null,
            status: 'active',
            horizon: 'year',
            target_date: '2027-05-18',
            color: null,
            area: null,
            settings: {
                progress_mode: 'rollup_strategies',
                importance: 5,
                weight_by_priority: false,
                start_date: null,
                manual_percent: null,
                percent: 33,
                health: 'at_risk',
                computed_at: null,
            },
            percent: 33,
            health: 'at_risk',
            strategies: [
                {
                    uid: 's1',
                    name: 'AI Agency',
                    kind: 'primary',
                    status: 'active',
                    importance: 5,
                    percent: 33,
                    health: 'at_risk',
                },
            ],
        },
    ]),
}));

describe('GoalsHqDashboard', () => {
    it('renders goal cards with progress and an at-risk callout', async () => {
        render(
            <MemoryRouter>
                <GoalsHqDashboard />
            </MemoryRouter>
        );

        await waitFor(() =>
            expect(screen.getByText('One Million')).toBeInTheDocument()
        );
        expect(screen.getByText('33%')).toBeInTheDocument();
        expect(
            screen.getByText(/behind schedule and need attention/i)
        ).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute(
            'aria-valuenow',
            '33'
        );
    });
});
