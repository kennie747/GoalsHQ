'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./controller');
const scheduler = require('./scheduler');

// Lazy, idempotent scheduler bootstrap — keeps app.js free of a startServer()
// edit. Runs once on the first GoalsHQ request; no-ops in test / when disabled.
let bootstrapped = false;
router.use((req, res, next) => {
    if (!bootstrapped) {
        bootstrapped = true;
        try {
            scheduler.initialize();
        } catch (err) {
            // never block a request on scheduler setup
            require('./core/tududi').logService.logError(
                `[goalshq] scheduler bootstrap failed: ${err.message}`,
                err
            );
        }
    }
    next();
});

router.get('/goalshq/config', controller.config);

// Goals
router.get('/goalshq/goals', controller.listGoals);
router.get('/goalshq/goals/:uid', controller.getGoal);
router.patch('/goalshq/goals/:uid/settings', controller.updateGoalSettings);
router.get('/goalshq/goals/:uid/strategies', controller.listStrategies);
router.post('/goalshq/goals/:uid/strategies', controller.createStrategy);
router.post('/goalshq/goals/:uid/recompute', controller.recomputeGoal);

// Strategies
router.get('/goalshq/strategies/:uid', controller.getStrategy);
router.patch('/goalshq/strategies/:uid', controller.updateStrategy);
router.delete('/goalshq/strategies/:uid', controller.deleteStrategy);
router.post('/goalshq/strategies/:uid/projects', controller.linkProject);
router.delete(
    '/goalshq/strategies/:uid/projects/:projectUid',
    controller.unlinkProject
);
router.delete('/goalshq/strategies/:uid/projects', controller.unlinkProject);
router.post('/goalshq/strategies/:uid/recompute', controller.recomputeStrategy);

// Key results (parentType = "goal" | "strategy")
router.get(
    '/goalshq/:parentType(goal|strategy)/:uid/key-results',
    controller.listKeyResults
);
router.post(
    '/goalshq/:parentType(goal|strategy)/:uid/key-results',
    controller.createKeyResult
);
router.patch('/goalshq/key-results/:uid', controller.updateKeyResult);
router.delete('/goalshq/key-results/:uid', controller.deleteKeyResult);

// Milestones
router.get(
    '/goalshq/:parentType(goal|strategy)/:uid/milestones',
    controller.listMilestones
);
router.post(
    '/goalshq/:parentType(goal|strategy)/:uid/milestones',
    controller.createMilestone
);
router.patch('/goalshq/milestones/:uid', controller.updateMilestone);
router.delete('/goalshq/milestones/:uid', controller.deleteMilestone);

module.exports = router;
