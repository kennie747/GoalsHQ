'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./controller');

// GET /api/tasks/carryover - the review queue (all unreviewed events)
router.get('/tasks/carryover', controller.listPending);
// GET /api/tasks/carryover/history - read-only archive of every past event
router.get('/tasks/carryover/history', controller.listHistory);
router.post('/tasks/carryover/:id/accept', controller.accept);
router.post('/tasks/carryover/:id/override', controller.override);

module.exports = router;
