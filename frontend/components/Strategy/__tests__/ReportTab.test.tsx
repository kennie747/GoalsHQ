import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ReportTab from '../ReportTab';
import { fetchGoalshqReport } from '../../../utils/goalsHqService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any) => (typeof fb === 'string' ? fb : _k),
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    fetchGoalshqReport: jest.fn(),
}));
jest.mock('../../Shared/ProgressIndicators', () => ({
    ProgressBar: () => <div data-testid="bar" />,
    HealthChip: ({ health }: any) => <span>{health}</span>,
    PercentLabel: ({ percent }: any) => <span>{percent}%</span>,
}));

const mockReport = fetchGoalshqReport as jest.Mock;

const report = {
    title: 'Real Estate',
    period: '30d',
    quantitative: {
        execution_percent: 49,
        execution_health: 'at_risk',
        outcome_percent: 24,
        outcome_health: 'off_track',
        key_results: [
            {
                name: 'Doors owned',
                current_value: 4,
                target_value: 10,
                unit: '',
                percent: 40,
            },
        ],
        by_category: [{ key: 'Path S', count: 3, sum: 0 }],
        milestones: [{ status: 'achieved' }, { status: 'pending' }],
        record_count: 5,
    },
    qualitative: {
        narrative: 'Real Estate moved from 38% to 49% this quarter.',
        narrative_source: 'static',
        notes: [],
    },
};

describe('ReportTab', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders quantitative panels from the report payload', async () => {
        mockReport.mockResolvedValue(report);
        render(<ReportTab parentType="strategy" parentUid="s1" />);

        expect(
            await screen.findByText(/Report · Real Estate/)
        ).toBeInTheDocument();
        expect(screen.getByText('Doors owned')).toBeInTheDocument();
        expect(screen.getByText('Path S')).toBeInTheDocument();
        expect(screen.getByText('1 / 2 achieved')).toBeInTheDocument();
        expect(screen.getByText('5 records')).toBeInTheDocument();
    });

    it('reveals the qualitative narrative only after expanding the card', async () => {
        mockReport.mockResolvedValue(report);
        render(<ReportTab parentType="strategy" parentUid="s1" />);
        await screen.findByText(/Report · Real Estate/);

        expect(
            screen.queryByText(/moved from 38%/)
        ).not.toBeInTheDocument();
        await userEvent.click(screen.getByText('Qualitative'));
        await waitFor(() =>
            expect(screen.getByText(/moved from 38%/)).toBeInTheDocument()
        );
    });
});
