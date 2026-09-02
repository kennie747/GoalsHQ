'use strict';

/**
 * Module-local model registry. GoalsHQ models are registered on tududi's shared
 * Sequelize instance but are intentionally NOT wired into backend/models/index.js
 * (no core-file edit, no cross-model associations) — see
 * docs/goalshq/adr/0001-isolation-architecture.md.
 *
 * Requiring this file is enough to define the tables on the shared instance, so
 * `sequelize.sync()` (tests) and a running server both pick them up.
 */

const { sequelize } = require('../../../models');

const GoalshqStrategy = require('./strategy')(sequelize);
const GoalshqProjectStrategy = require('./projectStrategy')(sequelize);
const GoalshqGoalSettings = require('./goalSettings')(sequelize);
const GoalshqKeyResult = require('./keyResult')(sequelize);
const GoalshqMilestone = require('./milestone')(sequelize);
const GoalshqProgressSnapshot = require('./progressSnapshot')(sequelize);

module.exports = {
    sequelize,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqProgressSnapshot,
};
