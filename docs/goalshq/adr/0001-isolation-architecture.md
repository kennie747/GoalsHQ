# ADR 0001 — GoalsHQ isolation architecture

**Status:** accepted · **Date:** 2026-09-02

## Context

GoalsHQ is built inside a **fork** of `chrisvel/tududi` that is kept current by
**merging** upstream. The overriding requirement is that GoalsHQ keeps working
across upstream merges with conflicts confined to a handful of one-line hunks,
and that it is **strictly additive** — no existing tududi behaviour is removed,
narrowed, hidden, reordered, or disabled.

## Decisions & trade-offs

### 1. No Sequelize associations from GoalsHQ tables to core models; models defined outside `backend/models/index.js`

GoalsHQ models are defined in `backend/modules/goalshq/models/` and registered on
tududi's shared Sequelize instance as a require-time side effect. `goal_id`,
`project_id`, `task_id`, `user_id` are plain integer columns; joins to core rows
are done explicitly in the repository.

- **Why:** `backend/models/index.js` is the single worst merge hotspot (explicit
  require list + ~220 lines of inline associations + an exports object). Touching
  it would create a conflict on almost every upstream merge.
- **Cost:** serializers assemble responses manually instead of via `include`;
  a little more repository code.
- **Revisit if:** upstream adds a per-model `associate()` hook, or GoalsHQ needs
  deep relational queries that are painful to hand-roll.

### 2. FKs declared in migrations but integrity enforced in application code

Migrations declare `references` / `onDelete: 'CASCADE'`, but tududi runs SQLite
with `PRAGMA foreign_keys = OFF`, so cascades do not fire.

- **Consequence:** deleting a core Goal/Project leaves orphan `goalshq_*` rows.
- **Mitigation:** every rollup/read query joins to the live core row and skips
  rows whose parent is gone; a nightly `gcOrphans()` sweep hard-deletes
  long-orphaned rows.
- **Revisit if:** upstream enables foreign-key enforcement.

### 3. Polymorphic child tables (`parent_type ∈ {goal, strategy}`)

Key results, milestones and progress snapshots each use one table with a
`parent_type` discriminator rather than separate per-tier tables.

- **Why:** half the tables, half the endpoints, half the serializers.
- **Cost:** no DB-level FK on `parent_id`; parent ownership is checked in the
  service before every write.

### 4. Project ↔ Strategy link is our own join table

`goalshq_project_strategies` (unique `project_id`) instead of a
`goalshq_strategy_id` column on `projects`.

- **Why:** zero changes to tududi's `projects` schema.
- **Rule:** a project belongs to at most one strategy.

### 5. Rollup scheduler self-initialises lazily from the router

`scheduler.initialize()` is called once, from a middleware at the top of the
GoalsHQ router, instead of from `app.js` `startServer()`.

- **Why:** keeps `backend/app.js` at exactly two appended lines.
- **Cost:** the cron sweep does not start until the first GoalsHQ request after a
  boot — acceptable, since there is nothing to recompute until someone uses it.
  Recompute-on-read and explicit `recompute` calls cover the gap.

### 6. Separate frontend Zustand store (`useGoalsHqStore`)

House style is a slice inside `frontend/store/useStore.ts` (1000+ lines). GoalsHQ
uses its own `create()` store with the same slice shape.

- **Why:** zero conflict surface on that hot file.
- **Cost:** goal core data (title, dates) is duplicated between tududi's
  `goalsStore` and ours; GoalsHQ refetches on route mount and after its own
  mutations to bound staleness.

### 7. Feature gate = `GOALSHQ_ENABLED` env var, read in-module

No edit to `backend/modules/feature-flags/*` or `frontend/utils/featureFlags.ts`.
`GET /api/goalshq/config` exposes the flag; the UI shell and sidebar entry
self-hide when disabled.

### 8. One frontend entity file (`GoalsHq.ts`) instead of one-per-entity

- **Why:** fewer new files, smaller surface. All types are interfaces/unions with
  no runtime code.

## Merge tripwire

`backend/tests/integration/goalshq-contract.test.js` asserts the exact tududi
surface GoalsHQ depends on (Task status/priority constants and columns, Goal
`uid`, Project `goal_id`, error classes, timezone helpers, and that
`models/index.js` contains no `goalshq` reference). Any upstream drift fails
`npm test` immediately.
