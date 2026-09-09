import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import LogResultModal from '../LogResultModal';
import {
    createRecord,
    fetchGoalshqProject,
    fetchGoalshqGoal,
} from '../../../utils/goalsHqService';
import { uploadAttachmentTo } from '../../../utils/attachmentsService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any) => (typeof fb === 'string' ? fb : _k),
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    createRecord: jest.fn(),
    fetchGoalshqProject: jest.fn(),
    fetchGoalshqGoal: jest.fn(),
}));
jest.mock('../../../utils/attachmentsService', () => ({
    uploadAttachmentTo: jest.fn(),
}));
const showSuccessToast = jest.fn();
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({ showSuccessToast, showErrorToast: jest.fn() }),
}));

const mockCreate = createRecord as jest.Mock;

describe('LogResultModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fetchGoalshqProject as jest.Mock).mockResolvedValue({
            key_results: [{ uid: 'kr1', name: 'Qualified leads' }],
        });
        (fetchGoalshqGoal as jest.Mock).mockResolvedValue({ key_results: [] });
    });

    it('creates a task-linked record with value/unit and uploads evidence', async () => {
        mockCreate.mockResolvedValue({ uid: 'rec1' });
        render(
            <LogResultModal
                taskUid="t1"
                taskName="Outreach to warm contacts"
                projectUid="p1"
                goalUid={null}
                onClose={jest.fn()}
            />
        );

        await userEvent.type(screen.getByLabelText('Value'), '6');
        await userEvent.type(screen.getByLabelText('Unit'), 'leads');
        await userEvent.click(screen.getByText(/more/));
        const fileInput = document.querySelector(
            'input[type=file]'
        ) as HTMLInputElement;
        await userEvent.upload(
            fileInput,
            new File(['x'], 'crm.csv', { type: 'text/csv' })
        );
        await userEvent.click(screen.getByText('Log result'));

        await waitFor(() =>
            expect(mockCreate).toHaveBeenCalledWith(
                'project',
                'p1',
                expect.objectContaining({
                    title: 'Outreach to warm contacts',
                    amount: 6,
                    unit: 'leads',
                    task_uid: 't1',
                })
            )
        );
        await waitFor(() =>
            expect(uploadAttachmentTo).toHaveBeenCalledWith(
                'goalshq_record',
                'rec1',
                expect.any(File)
            )
        );
        expect(showSuccessToast).toHaveBeenCalled();
    });

    it('Skip closes without creating a record', async () => {
        const onClose = jest.fn();
        render(
            <LogResultModal
                taskUid="t1"
                taskName="x"
                projectUid="p1"
                onClose={onClose}
            />
        );
        await userEvent.click(screen.getByText('Skip'));
        expect(onClose).toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
