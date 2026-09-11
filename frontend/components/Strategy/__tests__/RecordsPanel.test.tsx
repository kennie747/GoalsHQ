import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import RecordsPanel from '../RecordsPanel';
import { fetchRecords, createRecord } from '../../../utils/goalsHqService';
import { uploadAttachmentTo } from '../../../utils/attachmentsService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any) => (typeof fb === 'string' ? fb : _k),
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    fetchRecords: jest.fn(),
    createRecord: jest.fn(),
    deleteRecord: jest.fn(),
}));
jest.mock('../../../utils/attachmentsService', () => ({
    uploadAttachmentTo: jest.fn(),
    getDownloadUrl: (uid: string) => `/dl/${uid}`,
}));
const showErrorToast = jest.fn();
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({ showErrorToast, showSuccessToast: jest.fn() }),
}));

const mockFetch = fetchRecords as jest.Mock;
const mockCreate = createRecord as jest.Mock;

const record = (over = {}) => ({
    uid: 'r1',
    parent_type: 'project',
    record_date: '2026-09-05',
    title: 'FinTech A deposit',
    category: null,
    amount: 11000,
    unit: '$',
    status: null,
    counts_toward_kr_uid: 'kr1',
    evidence_url: null,
    task_id: null,
    note_id: null,
    body: null,
    attachments: [],
    ...over,
});

describe('RecordsPanel', () => {
    beforeEach(() => jest.clearAllMocks());

    it('lists records and shows a Σ toward a KR by name', async () => {
        mockFetch.mockResolvedValue([record()]);
        render(
            <RecordsPanel
                parentType="project"
                parentUid="p1"
                keyResults={
                    [{ uid: 'kr1', name: 'Net profit' }] as any
                }
            />
        );
        expect(
            await screen.findByText('FinTech A deposit')
        ).toBeInTheDocument();
        expect(screen.getByText('Net profit')).toBeInTheDocument();
    });

    it('creates a record and uploads evidence files', async () => {
        mockFetch.mockResolvedValue([]);
        mockCreate.mockResolvedValue({ uid: 'new1' });
        render(
            <RecordsPanel
                parentType="project"
                parentUid="p1"
                keyResults={[] as any}
            />
        );
        await waitFor(() => expect(mockFetch).toHaveBeenCalled());
        await userEvent.type(screen.getByPlaceholderText('Title'), 'Deposit');
        await userEvent.click(screen.getByText('⋯ more'));
        const fileInput = document.querySelector(
            'input[type=file]'
        ) as HTMLInputElement;
        await userEvent.upload(
            fileInput,
            new File(['x'], 'invoice.pdf', { type: 'application/pdf' })
        );
        await userEvent.click(screen.getByText('Add'));

        await waitFor(() =>
            expect(mockCreate).toHaveBeenCalledWith(
                'project',
                'p1',
                expect.objectContaining({ title: 'Deposit' })
            )
        );
        await waitFor(() =>
            expect(uploadAttachmentTo).toHaveBeenCalledWith(
                'goalshq_record',
                'new1',
                expect.any(File)
            )
        );
    });
});
