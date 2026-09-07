/**
 * @swagger
 * tags:
 *   name: GoalsHQ
 *   description: Strategic goal-to-action layer. Whole-instance enablement is exposed as `features.goalshq_enabled` on GET /api/current_user, not a dedicated endpoint; disabled when GOALSHQ_ENABLED=false.
 */

/**
 * @swagger
 * /api/goalshq/goals:
 *   get:
 *     summary: List the user's goals with GoalsHQ progress, health and strategy summaries
 *     tags: [GoalsHQ]
 *     security:
 *       - cookieAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "{ goals: GoalSummary[] }"
 *       401:
 *         description: Authentication required
 */

/**
 * @swagger
 * /api/goalshq/goals/{uid}:
 *   get:
 *     summary: Goal detail — settings, strategies, key results, milestones, direct projects, trend
 *     tags: [GoalsHQ]
 *     security:
 *       - cookieAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ goal: GoalDetail }" }
 *       404: { description: Goal not found }
 */

/**
 * @swagger
 * /api/goalshq/goals/{uid}/settings:
 *   patch:
 *     summary: Update goal progress mode / importance / start date / manual percent
 *     tags: [GoalsHQ]
 *     security:
 *       - cookieAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ settings }" }
 */

/**
 * @swagger
 * /api/goalshq/goals/{uid}/strategies:
 *   get:
 *     summary: List strategies for a goal
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ strategies: Strategy[] }" }
 *   post:
 *     summary: Create a strategy under a goal
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: "{ strategy }" }
 *       400: { description: Validation error }
 */

/**
 * @swagger
 * /api/goalshq/strategies/{uid}:
 *   get:
 *     summary: Strategy detail
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ strategy }" }
 *   patch:
 *     summary: Update a strategy
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ strategy }" }
 *   delete:
 *     summary: Delete a strategy (unlinks its projects, removes its metrics)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Deleted }
 */

/**
 * @swagger
 * /api/goalshq/strategies/{uid}/projects:
 *   post:
 *     summary: Link a tududi project to this strategy
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_uid: { type: string }
 *               weight: { type: number }
 *     responses:
 *       200: { description: "{ strategy }" }
 */

/**
 * @swagger
 * /api/goalshq/{parentType}/{uid}/key-results:
 *   post:
 *     summary: Add a key result to a goal or strategy
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: parentType
 *         required: true
 *         schema: { type: string, enum: [goal, strategy] }
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: "{ key_result }" }
 */

/**
 * @swagger
 * /api/goalshq/{parentType}/{uid}/milestones:
 *   post:
 *     summary: Add a milestone to a goal or strategy
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: parentType
 *         required: true
 *         schema: { type: string, enum: [goal, strategy] }
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: "{ milestone }" }
 */

/**
 * @swagger
 * /api/goalshq/goals/{uid}/recompute:
 *   post:
 *     summary: Force a rollup recompute for a goal (and its strategies)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ goal: GoalDetail }" }
 */
