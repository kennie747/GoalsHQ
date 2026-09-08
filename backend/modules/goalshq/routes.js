'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Scheduler is initialized once from backend/app.js's startServer(), alongside
// taskScheduler/caldavSyncScheduler — see backend/modules/goalshq/scheduler.js.

// Goals
router.get('/goalshq/goals', controller.listGoals);
router.get('/goalshq/goals/:uid', controller.getGoal);
router.patch('/goalshq/goals/:uid/settings', controller.updateGoalSettings);
router.get('/goalshq/goals/:uid/strategies', controller.listStrategies);
router.post('/goalshq/goals/:uid/strategies', controller.createStrategyForGoal);
router.post('/goalshq/goals/:uid/recompute', controller.recomputeGoal);

// Projects (measurable tier — Phase A Follow-up)
router.get('/goalshq/projects/:uid', controller.getProject);
router.patch(
    '/goalshq/projects/:uid/settings',
    controller.updateProjectSettings
);
router.put(
    '/goalshq/projects/:uid/strategies',
    controller.setProjectStrategies
);

// Strategies
router.get('/goalshq/strategies', controller.listAllStrategies);
router.post('/goalshq/strategies', controller.createStrategy);
router.get('/goalshq/strategies/:uid', controller.getStrategy);
router.patch('/goalshq/strategies/:uid', controller.updateStrategy);
router.delete('/goalshq/strategies/:uid', controller.deleteStrategy);
router.put('/goalshq/strategies/:uid/projects', controller.setStrategyProjects);
router.post('/goalshq/strategies/:uid/projects', controller.linkProject);
router.delete(
    '/goalshq/strategies/:uid/projects/:projectUid',
    controller.unlinkProject
);
router.delete('/goalshq/strategies/:uid/projects', controller.unlinkProject);
router.post('/goalshq/strategies/:uid/recompute', controller.recomputeStrategy);

// Key results (parentType = "goal" | "strategy" | "project" | "task" — a
// task-parented KeyResult is the "batch/quota task" primitive, informational
// only, see AF3 in docs/goalshq/adr/0002-first-class-integration.md)
router.get(
    '/goalshq/:parentType(goal|strategy|project|task)/:uid/key-results',
    controller.listKeyResults
);
router.post(
    '/goalshq/:parentType(goal|strategy|project|task)/:uid/key-results',
    controller.createKeyResult
);
router.patch('/goalshq/key-results/:uid', controller.updateKeyResult);
router.delete('/goalshq/key-results/:uid', controller.deleteKeyResult);

// Milestones (parentType = "goal" | "strategy" | "project" — deliberately not
// "task", a task already has a due_date/status)
router.get(
    '/goalshq/:parentType(goal|strategy|project)/:uid/milestones',
    controller.listMilestones
);
router.post(
    '/goalshq/:parentType(goal|strategy|project)/:uid/milestones',
    controller.createMilestone
);
router.patch('/goalshq/milestones/:uid', controller.updateMilestone);
router.delete('/goalshq/milestones/:uid', controller.deleteMilestone);
router.post('/goalshq/milestones/:uid/expand', controller.expandMilestone);
router.put('/goalshq/milestones/:uid/tasks', controller.setMilestoneTasks);

// Records ledger (Part 2)
router.get(
    '/goalshq/:parentType(goal|strategy|project)/:uid/records',
    controller.listRecords
);
router.post(
    '/goalshq/:parentType(goal|strategy|project)/:uid/records',
    controller.createRecord
);
router.patch('/goalshq/records/:uid', controller.updateRecord);
router.delete('/goalshq/records/:uid', controller.deleteRecord);

// KR check-in history + propagation
router.get('/goalshq/key-results/:uid', controller.getKeyResult);
router.get('/goalshq/key-results/:uid/entries', controller.listKrEntries);
router.post('/goalshq/key-results/:uid/entries', controller.createKrEntry);
router.post(
    '/goalshq/key-results/:uid/propagate',
    controller.propagateKeyResult
);

// Per-entity report
router.get(
    '/goalshq/:parentType(goal|strategy|project)/:uid/report',
    controller.getReport
);

module.exports = router;
