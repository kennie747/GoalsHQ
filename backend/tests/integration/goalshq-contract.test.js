/**
 * GoalsHQ ↔ tududi contract tests — the upstream-merge tripwire.
 *
 * GoalsHQ is built as an isolated module that depends on a small, explicit slice
 * of tududi core (see backend/modules/goalshq/core/tududi.js). If an upstream
 * merge renames/moves/removes any of the surface asserted here, this file fails
 * immediately and points at the broken assumption — before users hit it.
 */

const path = require('path');

describe('GoalsHQ core contract', () => {
    describe('tududi surface the compat shim relies on', () => {
        const shim = require('../../modules/goalshq/core/tududi');

        it('exposes the core models', () => {
            expect(shim.Goal).toBeDefined();
            expect(shim.Project).toBeDefined();
            expect(shim.Task).toBeDefined();
            expect(shim.User).toBeDefined();
            expect(shim.sequelize).toBeDefined();
        });

        it('exposes Task.STATUS with DONE / ARCHIVED / CANCELLED', () => {
            expect(shim.TASK_STATUS).toBeDefined();
            expect(typeof shim.TASK_STATUS.DONE).toBe('number');
            expect(typeof shim.TASK_STATUS.ARCHIVED).toBe('number');
            expect(typeof shim.TASK_STATUS.CANCELLED).toBe('number');
        });

        it('exposes Task.PRIORITY with LOW / MEDIUM / HIGH', () => {
            expect(shim.TASK_PRIORITY).toBeDefined();
            expect(typeof shim.TASK_PRIORITY.LOW).toBe('number');
            expect(typeof shim.TASK_PRIORITY.MEDIUM).toBe('number');
            expect(typeof shim.TASK_PRIORITY.HIGH).toBe('number');
        });

        it('isDone / isExcluded behave as GoalsHQ rollup expects', () => {
            expect(shim.isDone({ status: shim.TASK_STATUS.DONE })).toBe(true);
            expect(shim.isDone({ status: shim.TASK_STATUS.IN_PROGRESS })).toBe(
                false
            );
            expect(shim.isExcluded({ status: shim.TASK_STATUS.ARCHIVED })).toBe(
                true
            );
            expect(
                shim.isExcluded({ status: shim.TASK_STATUS.CANCELLED })
            ).toBe(true);
            expect(
                shim.isExcluded({ status: shim.TASK_STATUS.NOT_STARTED })
            ).toBe(false);
        });

        it('exposes error classes, config, logService and auth helper', () => {
            expect(shim.errors.NotFoundError).toBeDefined();
            expect(shim.errors.ValidationError).toBeDefined();
            expect(shim.errors.ConflictError).toBeDefined();
            expect(shim.config).toHaveProperty('environment');
            expect(typeof shim.logService.logError).toBe('function');
            expect(typeof shim.getAuthenticatedUserId).toBe('function');
        });

        it('exposes timezone helpers used for snapshot dating', () => {
            expect(typeof shim.timezone.getCurrentDateInTimezone).toBe(
                'function'
            );
            expect(typeof shim.timezone.getSafeTimezone).toBe('function');
            expect(shim.todayInUserTz({ timezone: 'UTC' })).toMatch(
                /^\d{4}-\d{2}-\d{2}$/
            );
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

    describe('GoalsHQ models register on the shared instance', () => {
        const registry = require('../../modules/goalshq/models');

        it('defines all six goalshq_* tables', () => {
            expect(registry.GoalshqStrategy.tableName).toBe(
                'goalshq_strategies'
            );
            expect(registry.GoalshqProjectStrategy.tableName).toBe(
                'goalshq_project_strategies'
            );
            expect(registry.GoalshqGoalSettings.tableName).toBe(
                'goalshq_goal_settings'
            );
            expect(registry.GoalshqKeyResult.tableName).toBe(
                'goalshq_key_results'
            );
            expect(registry.GoalshqMilestone.tableName).toBe(
                'goalshq_milestones'
            );
            expect(registry.GoalshqProgressSnapshot.tableName).toBe(
                'goalshq_progress_snapshots'
            );
        });

        it('shares tududi’s sequelize instance (no separate connection)', () => {
            expect(registry.sequelize).toBe(require('../../models').sequelize);
        });
    });

    it('does not edit backend/models/index.js (no goalshq refs in core registry)', () => {
        const fs = require('fs');
        const src = fs.readFileSync(
            path.join(__dirname, '../../models/index.js'),
            'utf8'
        );
        expect(src.toLowerCase()).not.toContain('goalshq');
    });
});
