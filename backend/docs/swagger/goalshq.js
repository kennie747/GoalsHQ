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
 *     summary: Toggle outcome metrics (metrics_enabled) / start_date / manual_percent (execution override)
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
 * /api/goalshq/strategies:
 *   get:
 *     summary: List every strategy the user owns (including goal-less ones)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     responses:
 *       200: { description: "{ strategies: Strategy[] }" }
 *   post:
 *     summary: Create a strategy (grouping bucket). Only `name` is required.
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string, nullable: true }
 *               color: { type: string, nullable: true }
 *               status: { type: string, enum: [active, paused, achieved, dropped] }
 *               metrics_editable: { type: boolean }
 *               goal_uid: { type: string, nullable: true, description: "null attaches no goal" }
 *               project_uids: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: "{ strategy }" }
 *
 * /api/goalshq/strategies/{uid}/projects:
 *   put:
 *     summary: Replace the strategy's whole project set
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_uids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: "{ strategy }" }
 *   post:
 *     summary: Link one project to this strategy
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_uid: { type: string }
 *     responses:
 *       200: { description: "{ strategy }" }
 *
 * /api/goalshq/projects/{uid}/strategies:
 *   put:
 *     summary: Replace a project's whole strategy set (from the project side)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               strategy_uids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: "{ strategy_uids }" }
 *
 * /api/goalshq/{parentType}/{uid}/records:
 *   get:
 *     summary: List records for a goal / strategy / project
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: parentType, required: true, schema: { type: string, enum: [goal, strategy, project] } }
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ records: GoalshqRecord[] }" }
 *   post:
 *     summary: Add a record to the ledger (optionally counts toward a KR, optionally task-linked)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: parentType, required: true, schema: { type: string, enum: [goal, strategy, project] } }
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               record_date: { type: string, format: date }
 *               amount: { type: number, nullable: true }
 *               unit: { type: string, nullable: true }
 *               category: { type: string, nullable: true }
 *               status: { type: string, nullable: true }
 *               counts_toward_kr_uid: { type: string, nullable: true }
 *               evidence_url: { type: string, nullable: true }
 *               task_uid: { type: string, nullable: true }
 *               body: { type: string, nullable: true }
 *     responses:
 *       201: { description: "{ record }" }
 *
 * /api/goalshq/records/{uid}:
 *   patch: { summary: Update a record, tags: [GoalsHQ], responses: { 200: { description: "{ record }" } } }
 *   delete: { summary: Delete a record (and its evidence files), tags: [GoalsHQ], responses: { 204: { description: "" } } }
 *
 * /api/goalshq/key-results/{uid}:
 *   get:
 *     summary: Key result detail — children, coverage (for rollup KRs), check-in history
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ key_result }" }
 *
 * /api/goalshq/key-results/{uid}/entries:
 *   get: { summary: List KR check-ins, tags: [GoalsHQ], responses: { 200: { description: "{ entries }" } } }
 *   post:
 *     summary: Add a KR check-in (dated absolute value)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value: { type: number }
 *               entry_date: { type: string, format: date }
 *               note: { type: string, nullable: true }
 *     responses:
 *       201: { description: "{ entry }" }
 *
 * /api/goalshq/key-results/{uid}/propagate:
 *   post:
 *     summary: Create child KRs on the given strategies/projects and flip this KR to child_kr_sum
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nodes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     parent_type: { type: string, enum: [goal, strategy, project] }
 *                     parent_uid: { type: string }
 *     responses:
 *       200: { description: "{ key_result }" }
 *
 * /api/goalshq/milestones/{uid}/tasks:
 *   put:
 *     summary: Set which task(s) a milestone auto-achieves from
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               task_uids: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: "{ milestones }" }
 *
 * /api/goalshq/{parentType}/{uid}/report:
 *   get:
 *     summary: Assembled per-entity report (quantitative panels + narrative)
 *     tags: [GoalsHQ]
 *     security: [ { cookieAuth: [] }, { BearerAuth: [] } ]
 *     parameters:
 *       - { in: path, name: parentType, required: true, schema: { type: string, enum: [goal, strategy, project] } }
 *       - { in: path, name: uid, required: true, schema: { type: string } }
 *       - { in: query, name: period, schema: { type: string, enum: ['30d', quarter, all] } }
 *       - { in: query, name: narrative, schema: { type: string, enum: ['false'] }, description: "'false' forces the static summary" }
 *     responses:
 *       200: { description: "{ report: GoalshqReport }" }
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
