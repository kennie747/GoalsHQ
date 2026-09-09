import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import StrategyModal from '../StrategyModal';
import {
    createStrategy,
    deleteStrategy,
    fetchGoalshqGoals,
} from '../../../utils/goalsHqService';
import { fetchProjects } from '../../../utils/projectsService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any) => (typeof fb === 'string' ? fb : _k),
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    createStrategy: jest.fn(),
    updateStrategy: jest.fn(),
    deleteStrategy: jest.fn(),
    fetchGoalshqGoals: jest.fn(),
}));
jest.mock('../../../utils/projectsService', () => ({ fetchProjects: jest.fn() }));
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({
        showErrorToast: jest.fn(),
        showSuccessToast: jest.fn(),
    }),
}));
jest.mock('../../Shared/ColorPicker', () => {
    const Cp = () => <div data-testid="cp" />;
    return Cp;
});

const mockCreate = createStrategy as jest.Mock;

describe('StrategyModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fetchGoalshqGoals as jest.Mock).mockResolvedValue([]);
        (fetchProjects as jest.Mock).mockResolvedValue([]);
    });

    it('requires a name and creates a standalone strategy', async () => {
        mockCreate.mockResolvedValue({ uid: 's1', name: 'Real Estate' });
        const onSaved = jest.fn();
        render(
            <StrategyModal
                isOpen
                onClose={jest.fn()}
                onSaved={onSaved}
                strategy={null}
            />
        );

        await userEvent.click(screen.getByText('Create'));
        expect(mockCreate).not.toHaveBeenCalled();

        await userEvent.type(
            screen.getByPlaceholderText(/strateg/i),
            'Real Estate'
        );
        await userEvent.click(screen.getByText('Create'));

        await waitFor(() =>
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Real Estate',
                    goal_uid: null,
                })
            )
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('deletes only after the irreversible-delete confirmation', async () => {
        (deleteStrategy as jest.Mock).mockResolvedValue(undefined);
        const onDeleted = jest.fn();
        render(
            <StrategyModal
                isOpen
                onClose={jest.fn()}
                onSaved={jest.fn()}
                onDeleted={onDeleted}
                strategy={
                    { uid: 's1', name: 'Real Estate', status: 'active' } as any
                }
            />
        );

        await userEvent.click(screen.getByTitle('Delete'));
        expect(deleteStrategy).not.toHaveBeenCalled();
        await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        await waitFor(() =>
            expect(deleteStrategy).toHaveBeenCalledWith('s1')
        );
    });
});
