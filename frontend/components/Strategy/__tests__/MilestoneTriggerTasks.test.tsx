import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MilestoneTriggerTasks, {
    __clearTaskPoolCache,
} from '../MilestoneTriggerTasks';
import { fetchTasks } from '../../../utils/tasksService';

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
jest.mock('../../../utils/tasksService', () => ({ fetchTasks: jest.fn() }));

const mockFetch = fetchTasks as jest.Mock;

const hdr = (name: RegExp) => screen.getByRole('button', { name });
const findHdr = (name: RegExp) => screen.findByRole('button', { name });

const task = (over: any) => ({
    uid: over.uid,
    name: over.name,
    status: over.status ?? 'not_started',
    Area: over.area ? { uid: over.area, name: over.area } : null,
    Goal: over.goal
        ? {
              uid: over.goal,
              title: over.goal,
              status: over.goalStatus ?? 'active',
          }
        : null,
    Project: over.project
        ? {
              uid: over.project,
              name: over.project,
              status: over.projectStatus ?? 'in_progress',
          }
        : null,
    project_uid: over.project ?? undefined,
    goal_uid: over.goal ?? undefined,
    area_uid: over.area ?? undefined,
});

const POOL = [
    task({ uid: 'a', name: 'alpha task', area: 'Work', goal: 'G1', project: 'P1' }),
    task({ uid: 'b', name: 'beta task', area: 'Work', goal: 'G1', project: 'P1' }),
    task({ uid: 'c', name: 'gamma task', area: 'Life', goal: 'G2', project: 'P2' }),
    task({
        uid: 'd',
        name: 'delta done-project',
        area: 'Life',
        goal: 'G2',
        project: 'P3',
        projectStatus: 'done',
    }),
    task({ uid: 'e', name: 'direct goal task', area: 'Work', goal: 'G1' }),
];

const renderCmp = (
    props: Partial<React.ComponentProps<typeof MilestoneTriggerTasks>> = {}
) =>
    render(
        <MilestoneTriggerTasks
            linkedTaskUids={props.linkedTaskUids ?? []}
            linkedProjectUids={props.linkedProjectUids ?? []}
            onToggleTask={props.onToggleTask ?? jest.fn()}
            onToggleProject={props.onToggleProject ?? jest.fn()}
        />
    );

describe('MilestoneTriggerTasks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __clearTaskPoolCache();
        mockFetch.mockResolvedValue({ tasks: POOL });
    });

    it('excludes done-project tasks and groups the rest by Area › Goal › Project', async () => {
        renderCmp();
        expect(await findHdr(/Work/)).toBeInTheDocument();
        expect(hdr(/Life/)).toBeInTheDocument();
        expect(
            screen.queryByText('delta done-project')
        ).not.toBeInTheDocument();
        expect(screen.queryByText('alpha task')).not.toBeInTheDocument();
    });

    it('drills down to a project and shows a direct-goal task under "Direct tasks"', async () => {
        renderCmp();
        await userEvent.click(await findHdr(/Work/));
        await userEvent.click(hdr(/G1/));
        // direct-goal task (no project) renders as a loose leaf under the goal
        expect(screen.getByText('direct goal task')).toBeInTheDocument();
        await userEvent.click(hdr(/P1/));
        expect(screen.getByText('alpha task')).toBeInTheDocument();
    });

    it('search narrows the tree', async () => {
        renderCmp();
        await findHdr(/Work/);
        await userEvent.type(
            screen.getByPlaceholderText('Search tasks…'),
            'gamma'
        );
        await waitFor(() =>
            expect(screen.getByText('gamma task')).toBeInTheDocument()
        );
        expect(screen.queryByText('alpha task')).not.toBeInTheDocument();
    });

    it('ticking a project header calls onToggleProject', async () => {
        const onToggleProject = jest.fn();
        renderCmp({ onToggleProject });
        await userEvent.click(await findHdr(/Work/));
        await userEvent.click(hdr(/G1/));
        const p1Row = hdr(/P1/).closest('div')!;
        await userEvent.click(p1Row.querySelector('input[type=checkbox]')!);
        expect(onToggleProject).toHaveBeenCalledWith('P1');
    });

    it('a whole-project link auto-expands and renders its leaves checked + disabled', async () => {
        renderCmp({ linkedProjectUids: ['P1'] });
        const leaf = (await screen.findByText('alpha task'))
            .closest('label')!
            .querySelector('input')!;
        expect(leaf).toBeChecked();
        expect(leaf).toBeDisabled();
    });

    it('keeps an already-linked task in a done project visible so it can be unlinked', async () => {
        const onToggleTask = jest.fn();
        renderCmp({ linkedTaskUids: ['d'], onToggleTask });
        const leaf = await screen.findByText('delta done-project');
        const box = leaf.closest('label')!.querySelector('input')!;
        expect(box).toBeChecked();
        await userEvent.click(box);
        expect(onToggleTask).toHaveBeenCalledWith('d');
    });
});
