import {
    scoreCandidate,
    buildGoalHealthMap,
    buildProjectStrategyMap,
    buildGoalInfoMap,
} from '../suggestionScoringUtils';
import { Task } from '../../entities/Task';
import { Project } from '../../entities/Project';
import { GoalSummary } from '../../entities/Goal';

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        uid: 'proj-uid',
        name: 'Test Project',
        status: 'in_progress',
        ...overrides,
    } as Project;
}

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 1,
        uid: 'task-uid',
        name: 'Test Task',
        status: 'not_started',
        project_id: 1,
        ...overrides,
    } as Task;
}

function makeGoalSummary(overrides: Partial<GoalSummary> = {}): GoalSummary {
    return {
        uid: 'goal-uid',
        title: 'Test Goal',
        why: null,
        status: 'active',
        horizon: 'season',
        target_date: null,
        color: null,
        area: null,
        settings: null,
        percent: 40,
        health: 'at_risk',
        projects_count: 0,
        tasks_count: 0,
        strategies: [],
        ...overrides,
    };
}

describe('buildGoalHealthMap', () => {
    it('maps goal uid to health', () => {
        const map = buildGoalHealthMap([
            makeGoalSummary({ uid: 'a', health: 'on_track' }),
            makeGoalSummary({ uid: 'b', health: 'off_track' }),
        ]);
        expect(map.get('a')).toBe('on_track');
        expect(map.get('b')).toBe('off_track');
    });
});

describe('scoreCandidate — goal health awareness', () => {
    const project = makeProject({
        Goal: { uid: 'goal-uid', title: 'Ship the launch', status: 'active' },
    } as any);

    it('scores a plain "goal" bonus when the goal has no risk data', () => {
        const task = makeTask();
        const meta = scoreCandidate(task, [project], [], {}, new Map());
        expect(meta.reason).toBe('goal');
        expect(meta.reasonLabel).toContain('Ship the launch');
    });

    it('upgrades to "goal_at_risk" with a bigger bonus when the goal is at_risk', () => {
        const task = makeTask();
        const healthMap = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'at_risk' }),
        ]);
        const plain = scoreCandidate(task, [project], [], {}, new Map());
        const atRisk = scoreCandidate(task, [project], [], {}, healthMap);

        expect(atRisk.reason).toBe('goal_at_risk');
        expect(atRisk.reasonLabel).toContain('at-risk');
        expect(atRisk.reasonLabel).toContain('Ship the launch');
        expect(atRisk.score).toBeGreaterThan(plain.score);
    });

    it('also upgrades for off_track goals', () => {
        const task = makeTask();
        const healthMap = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'off_track' }),
        ]);
        const meta = scoreCandidate(task, [project], [], {}, healthMap);
        expect(meta.reason).toBe('goal_at_risk');
    });

    it('does not upgrade for on_track goals', () => {
        const task = makeTask();
        const healthMap = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'on_track' }),
        ]);
        const meta = scoreCandidate(task, [project], [], {}, healthMap);
        expect(meta.reason).toBe('goal');
    });

    it('a due-today task still wins over the goal bonus regardless of health', () => {
        const today = new Date().toISOString();
        const task = makeTask({ due_date: today });
        const healthMap = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'off_track' }),
        ]);
        const meta = scoreCandidate(task, [project], [], {}, healthMap);
        expect(meta.reason).toBe('due');
    });
});

describe('buildProjectStrategyMap', () => {
    it('maps a project id to the strategy it is linked to', () => {
        const project = makeProject({ id: 5, uid: 'proj-5' });
        const goalSummary = makeGoalSummary({
            strategies: [
                {
                    uid: 'strat-1',
                    name: 'Direct Outreach',
                    kind: 'primary',
                    status: 'active',
                    importance: 3,
                    percent: 20,
                    health: 'at_risk',
                    project_uids: ['proj-5'],
                projects: [],
                },
            ],
        });
        const map = buildProjectStrategyMap([goalSummary], [project]);
        expect(map.get(5)).toEqual({
            uid: 'strat-1',
            name: 'Direct Outreach',
            health: 'at_risk',
        });
    });

    it('picks the riskiest strategy when a project serves more than one', () => {
        const project = makeProject({ id: 5, uid: 'proj-5' });
        const goalSummary = makeGoalSummary({
            strategies: [
                {
                    uid: 'healthy-strat',
                    name: 'Healthy Strategy',
                    kind: 'secondary',
                    status: 'active',
                    importance: 2,
                    percent: 80,
                    health: 'on_track',
                    project_uids: ['proj-5'],
                projects: [],
                },
                {
                    uid: 'risky-strat',
                    name: 'Risky Strategy',
                    kind: 'primary',
                    status: 'active',
                    importance: 5,
                    percent: 10,
                    health: 'off_track',
                    project_uids: ['proj-5'],
                projects: [],
                },
            ],
        });
        const map = buildProjectStrategyMap([goalSummary], [project]);
        expect(map.get(5)?.uid).toBe('risky-strat');
    });
});

describe('scoreCandidate — strategy attribution takes priority over goal', () => {
    const project = makeProject({
        Goal: { uid: 'goal-uid', title: 'Ship the launch', status: 'active' },
    } as any);

    it('attributes to the strategy, not the goal, when the project is strategy-linked', () => {
        const task = makeTask();
        const goalHealthByUid = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'on_track' }),
        ]);
        const strategyByProjectId = new Map([
            [
                1,
                { uid: 'strat-1', name: 'Direct Outreach', health: 'at_risk' as const },
            ],
        ]);
        const meta = scoreCandidate(
            task,
            [project],
            [],
            {},
            goalHealthByUid,
            strategyByProjectId
        );
        expect(meta.reason).toBe('strategy_at_risk');
        expect(meta.reasonLabel).toContain('Direct Outreach');
        expect(meta.reasonLabel).not.toContain('Ship the launch');
    });

    it('falls back to goal attribution for a project with no strategy link', () => {
        const task = makeTask();
        const goalHealthByUid = buildGoalHealthMap([
            makeGoalSummary({ uid: 'goal-uid', health: 'at_risk' }),
        ]);
        const meta = scoreCandidate(
            task,
            [project],
            [],
            {},
            goalHealthByUid,
            new Map()
        );
        expect(meta.reason).toBe('goal_at_risk');
        expect(meta.reasonLabel).toContain('Ship the launch');
    });
});

describe('scoreCandidate — a task linked directly to a Goal with no project', () => {
    it('attributes at the goal level via task.goal_uid (the rollup engine\'s "direct bucket")', () => {
        const task = makeTask({
            project_id: null,
            goal_uid: 'goal-uid',
        } as any);
        const goalInfoByUid = buildGoalInfoMap([
            makeGoalSummary({
                uid: 'goal-uid',
                title: 'Make the first million',
                status: 'active',
                health: 'off_track',
            }),
        ]);

        const meta = scoreCandidate(
            task,
            [],
            [],
            {},
            new Map(),
            new Map(),
            goalInfoByUid
        );

        expect(meta.reason).toBe('goal_at_risk');
        expect(meta.reasonLabel).toContain('Make the first million');
    });

    it('does nothing when the goal is not active', () => {
        const task = makeTask({ project_id: null, goal_uid: 'goal-uid' } as any);
        const goalInfoByUid = buildGoalInfoMap([
            makeGoalSummary({
                uid: 'goal-uid',
                status: 'achieved',
                health: 'off_track',
            }),
        ]);

        const meta = scoreCandidate(
            task,
            [],
            [],
            {},
            new Map(),
            new Map(),
            goalInfoByUid
        );

        expect(meta.reason).not.toBe('goal_at_risk');
        expect(meta.reason).not.toBe('goal');
    });

    it('does nothing when there is no matching goal info', () => {
        const task = makeTask({ project_id: null, goal_uid: 'missing' } as any);
        const meta = scoreCandidate(task, [], [], {}, new Map(), new Map(), new Map());
        expect(meta.reason).not.toBe('goal_at_risk');
        expect(meta.reason).not.toBe('goal');
    });
});
