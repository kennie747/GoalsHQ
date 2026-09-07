# GoalsHQ integration points

GoalsHQ is no longer additive-only (see `adr/0002-first-class-integration.md`)
— it has real Sequelize associations, a real store slice, and real top-level
routes/sidebar entries, the same as Area/Goal/Project/Task. This means a
`git merge upstream/main` is expected to conflict non-trivially on the files
below, by design — see `UPSTREAM_TRACKING.md` for the review workflow that
replaces mergeability.

This page is a map of where GoalsHQ touches shared, non-`goalshq`-prefixed
files, for anyone (human or a future AI session) trying to understand the
blast radius of a change, not a list of isolated "hooks" to reapply.

## `backend/models/index.js`

GoalsHQ models (`GoalshqStrategy`, `GoalshqKeyResult`, `GoalshqMilestone`,
`GoalshqProgressSnapshot`, `GoalshqGoalSettings`, `GoalshqProjectSettings`,
`GoalshqProjectStrategy`) plus `TaskCarryoverEvent` are required and
registered alongside every core model, with real associations: `Goal.hasMany
Strategies`, `GoalshqStrategy.belongsTo(Goal)`, a many-to-many Strategy↔Project
via `GoalshqProjectStrategy`, and scoped polymorphic associations for
KeyResult/Milestone/ProgressSnapshot keyed on `[Goal,'goal']`/
`[GoalshqStrategy,'strategy']`/`[Project,'project']` (plus `[Task,'task']`
for KeyResult only). `TaskCarryoverEvent` has ordinary `User`/`Task`
associations.

## `backend/app.js`

`goalshqModule.routes` and the carryover routes (mounted under the tasks
module) are wired in `registerRoutes()`. The GoalsHQ scheduler and the
carryover-classification cron job are both started from `startServer()`
alongside `taskScheduler`/`caldavSyncScheduler` — no lazy self-init.

## `backend/modules/tasks/queries/query-builders.js`

All three task-include arrays (`filterTasksByParams`'s inline array,
`getTaskIncludeConfig()`, `getTaskIncludeConfigLight()`) include the `Goal`
association alongside `Project`/`Area`, so `task.goal_uid` populates for any
caller — this was a universal bug fix (Phase C), not GoalsHQ-specific, but it
lives in a file GoalsHQ depends on.

## `backend/modules/ai-assistant/service.js`

`fetchUserContext()` additionally calls the GoalsHQ repository for
strategy/KR/goal-settings context and the carryover repository for
repeat-postponed tasks; `buildContextSummary()` renders a "## Strategy & Key
Results" and a "## Keeps Getting Postponed" section. `generateDailyBrief()`
itself and its response schema are unchanged.

## `frontend/App.tsx`

Top-level routes: `/strategy`, `/strategy/:uidSlug`, `/archive` — ordinary
`<Route>` entries alongside `/goal/:uidSlug` etc., not a wildcard sub-app.

## `frontend/components/Goal/GoalDetails.tsx`

The Strategy section (percent/health, progress-mode selector, strategies list
with paused/experiment collapsing, direct projects, goal-level KR/milestone
panel) is embedded directly in the existing Goal detail page, gated by
`userSettingsStore.goalshqEnabled` — not a separate page.

## `frontend/components/Sidebar.tsx`

Renders `<SidebarStrategy>` (which itself renders both "Strategy" and
"Archive" nav entries) directly below `<SidebarGoals>`, gated by
`goalshqEnabled` read from `userSettingsStore`.

## `frontend/store/useStore.ts`

A `strategiesStore` slice (goal summaries for `/strategy` and the sidebar)
lives alongside every other slice in the same `create()` call — there is no
separate GoalsHQ store.

## `frontend/entities/*.ts`

`Goal.ts` includes `GoalSummary`/`GoalDetail` (with `strategies`/
`key_results`/`milestones`/`trend` fields); `Project.ts` includes `ProjectRef`;
`Task.ts`'s `_suggestionMeta.reason` union includes the goal/strategy-risk
reasons used by the Today worksheet's suggestion scoring
(`frontend/utils/suggestionScoringUtils.ts`).

## `public/locales/en/translation.json`

Three namespaces: `goalshq.*`, `carryover.*`, `archive.*`. Other languages
fall back to English automatically (`frontend/i18n.ts`).

## What is deliberately still separate

- `backend/modules/goalshq/` and `backend/modules/tasks/carryover/` — the
  business logic itself stays modular, just not isolated from the data layer.
- `backend/modules/feature-flags/*`, `frontend/utils/featureFlags.ts` — the
  gate is still the plain `GOALSHQ_ENABLED` env var / `goalshq_enabled` user
  feature flag, read in-module — no dependency on the generic feature-flags
  system.
- `frontend/config/paths.ts` — `getApiPath` takes any string, no whitelist.
