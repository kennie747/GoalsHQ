/**
 * GoalsHQ ↔ core contract tests.
 *
 * GoalsHQ is now a first-class part of core (see
 * docs/goalshq/adr/0002-first-class-integration.md — supersedes the isolation
 * architecture in adr/0001). These tests guard the concrete assumptions the
 * rollup engine and repository make about core Task/Goal/Project shape, so a
 * future refactor that drifts from them fails loudly here instead of via a
 * confusing GoalsHQ bug report.
 */

describe('GoalsHQ core contract', () => {
    describe('task status/priority surface the rollup engine relies on', () => {
        const taskStatus = require('../../modules/goalshq/operations/task-status');

        it('exposes Task.STATUS with DONE / ARCHIVED / CANCELLED', () => {
            expect(taskStatus.TASK_STATUS).toBeDefined();
            expect(typeof taskStatus.TASK_STATUS.DONE).toBe('number');
            expect(typeof taskStatus.TASK_STATUS.ARCHIVED).toBe('number');
            expect(typeof taskStatus.TASK_STATUS.CANCELLED).toBe('number');
        });

        it('exposes Task.PRIORITY with LOW / MEDIUM / HIGH', () => {
            expect(taskStatus.TASK_PRIORITY).toBeDefined();
            expect(typeof taskStatus.TASK_PRIORITY.LOW).toBe('number');
            expect(typeof taskStatus.TASK_PRIORITY.MEDIUM).toBe('number');
            expect(typeof taskStatus.TASK_PRIORITY.HIGH).toBe('number');
        });

        it('isDone / isExcluded behave as GoalsHQ rollup expects', () => {
            const { TASK_STATUS, isDone, isExcluded } = taskStatus;
            expect(isDone({ status: TASK_STATUS.DONE })).toBe(true);
            expect(isDone({ status: TASK_STATUS.IN_PROGRESS })).toBe(false);
            expect(isExcluded({ status: TASK_STATUS.ARCHIVED })).toBe(true);
            expect(isExcluded({ status: TASK_STATUS.CANCELLED })).toBe(true);
            expect(isExcluded({ status: TASK_STATUS.NOT_STARTED })).toBe(false);
        });
    });

    describe('core columns GoalsHQ joins against', () => {
        const { Goal, Project, Task } = require('../../models');

        it('Goal has uid', () => {
            expect(Goal.rawAttributes.uid).toBeDefined();
        });

        it('Project has goal_id', () => {
            expect(Project.rawAttributes.goal_id).toBeDefined();
        });

        it('Task has status / completed_at / goal_id / project_id / parent_task_id', () => {
            for (const attr of [
                'status',
                'completed_at',
                'goal_id',
                'project_id',
                'parent_task_id',
            ]) {
                expect(Task.rawAttributes[attr]).toBeDefined();
            }
        });
    });

    describe('GoalsHQ models are core-registered', () => {
        const models = require('../../models');

        it('defines all six goalshq_* tables on the shared instance', () => {
            expect(models.GoalshqStrategy.tableName).toBe('goalshq_strategies');
            expect(models.GoalshqProjectStrategy.tableName).toBe(
                'goalshq_project_strategies'
            );
            expect(models.GoalshqGoalSettings.tableName).toBe(
                'goalshq_goal_settings'
            );
            expect(models.GoalshqKeyResult.tableName).toBe(
                'goalshq_key_results'
            );
            expect(models.GoalshqMilestone.tableName).toBe(
                'goalshq_milestones'
            );
            expect(models.GoalshqProgressSnapshot.tableName).toBe(
                'goalshq_progress_snapshots'
            );
        });

        it('Goal <-> Strategy and Strategy <-> Project associations are wired', () => {
            expect(models.Goal.associations.Strategies).toBeDefined();
            expect(models.GoalshqStrategy.associations.Goal).toBeDefined();
            expect(models.GoalshqStrategy.associations.Projects).toBeDefined();
            expect(models.Project.associations.Strategies).toBeDefined();
        });
    });

    describe('project <-> strategy is many-to-many', () => {
        const { GoalshqProjectStrategy } = require('../../models');

        it('has no unique constraint on project_id alone', () => {
            const projectIdAttr =
                GoalshqProjectStrategy.rawAttributes.project_id;
            expect(projectIdAttr.unique).not.toBe(true);
        });
    });
});
