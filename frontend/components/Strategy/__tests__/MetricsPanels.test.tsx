import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MetricsPanels from '../MetricsPanels';
import { expandMilestone } from '../../../utils/goalsHqService';
import { Milestone } from '../../../entities/Milestone';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_k: string, fb?: any) => (typeof fb === 'string' ? fb : _k),
    }),
}));
jest.mock('../../../utils/goalsHqService', () => ({
    createKeyResult: jest.fn(),
    updateKeyResult: jest.fn(),
    deleteKeyResult: jest.fn(),
    createMilestone: jest.fn(),
    updateMilestone: jest.fn(),
    deleteMilestone: jest.fn(),
    expandMilestone: jest.fn(),
    createKrEntry: jest.fn(),
    propagateKeyResult: jest.fn(),
    fetchKeyResultDetail: jest.fn(),
    setMilestoneTasks: jest.fn(),
}));
jest.mock('../../../utils/tasksService', () => ({
    fetchTasks: jest.fn().mockResolvedValue({ tasks: [] }),
    fetchTaskByUid: jest.fn(),
}));

const mockExpand = expandMilestone as jest.Mock;

const ms = (over: Partial<Milestone> = {}): Milestone => ({
    uid: 'm1',
    parent_type: 'project',
    title: 'Ship v1',
    target_date: null,
    target_value: null,
    status: 'pending',
    achieved_at: null,
    sort_order: 0,
    completion_mode: 'all',
    task_uids: [],
    expanded_task_uid: null,
    ...over,
});

const renderPanel = (milestones: Milestone[], onChange = jest.fn()) =>
    render(
        <MemoryRouter>
            <MetricsPanels
                parentType="project"
                parentUid="p1"
                keyResults={[]}
                milestones={milestones}
                onChange={onChange}
            />
        </MemoryRouter>
    );

describe('MetricsPanels — expand into task', () => {
    beforeEach(() => jest.clearAllMocks());

    it('shows the expand button and calls expandMilestone once, then reloads', async () => {
        mockExpand.mockResolvedValue({ uid: 't1', already_existed: false });
        const onChange = jest.fn();
        renderPanel([ms()], onChange);

        const btn = screen.getByRole('button', { name: 'Expand into task' });
        await userEvent.click(btn);

        await waitFor(() => expect(mockExpand).toHaveBeenCalledWith('m1'));
        expect(mockExpand).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(onChange).toHaveBeenCalled());
    });

    it('once a task exists it shows a "Task created" link instead of the button', () => {
        renderPanel([ms({ expanded_task_uid: 't1', task_uids: ['t1'] })]);

        expect(
            screen.queryByRole('button', { name: 'Expand into task' })
        ).not.toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Task created' });
        expect(link).toHaveAttribute('href', '/task/t1');
    });

    it('the trigger panel shows the expanded task already linked/checked', async () => {
        const { fetchTaskByUid } = jest.requireMock('../../../utils/tasksService');
        (fetchTaskByUid as jest.Mock).mockResolvedValue({
            uid: 't1',
            name: 'Ship v1',
            status: 'not_started',
        });
        renderPanel([ms({ expanded_task_uid: 't1', task_uids: ['t1'] })]);

        await userEvent.click(screen.getByTitle('Auto-achieve triggers'));

        const checkbox = await screen.findByRole('checkbox', {
            name: /Ship v1/,
        });
        expect(checkbox).toBeChecked();
    });
});
