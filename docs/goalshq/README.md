# GoalsHQ (add-on)

GoalsHQ is a **strictly additive** strategic-execution layer on top of tududi. It adds:

- a **Strategy / Outcome tier** between a Goal and its Projects
  (`Goal → Strategy → Project → Task`, plus a direct `Goal → Project` bucket);
- **measurable goals & strategies** — key results, milestones, importance, health;
- an automatic **progress rollup** (task → project → strategy → goal) with daily
  snapshots for trend lines.

It never modifies, hides, reorders, or disables any existing tududi feature. With
GoalsHQ turned off, tududi behaves exactly as before.

> **Running & testing locally:** see [`RUNNING.md`](RUNNING.md) — the dev runbook
> (frontend `:8081` / backend `:3003`, `bash scripts/dev.sh`, test commands,
> troubleshooting).

## Where it lives

| Area | Path |
|---|---|
| Backend module | `backend/modules/goalshq/` |
| Migrations | `backend/migrations/20260902000001..6-goalshq-*.js` |
| Backend tests | `backend/tests/unit/goalshq/`, `backend/tests/integration/goalshq*.test.js` |
| Swagger | `backend/docs/swagger/goalshq.js` |
| Frontend | `frontend/components/GoalsHQ/`, `frontend/store/useGoalsHqStore.ts`, `frontend/utils/goalsHqService.ts`, `frontend/entities/GoalsHq.ts` |
| Sidebar | `frontend/components/Sidebar/SidebarGoalsHQ.tsx` |
| i18n | `public/locales/en/translation.json` → `goalshq.*` |
| Integration hooks | `backend/app.js`, `frontend/App.tsx`, `frontend/components/Sidebar.tsx` (see `INTEGRATION.md`) |

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `GOALSHQ_ENABLED` | `true` | Set `false` to hide the UI + disable `/api/goalshq/*` |
| `GOALSHQ_RECOMPUTE_CRON` | `*/15 * * * *` | Rollup sweep schedule |
| `GOALSHQ_STALE_MINUTES` | `20` | Recompute-on-read threshold |
| `GOALSHQ_GC_CRON` | `30 3 * * *` | Nightly orphan GC |

Zero config required — every value has a sane default.

## Data model

Six `goalshq_`-prefixed tables, no changes to `goals` / `projects` / `tasks`:
`goalshq_strategies`, `goalshq_project_strategies`, `goalshq_goal_settings`,
`goalshq_key_results` (polymorphic), `goalshq_milestones` (polymorphic),
`goalshq_progress_snapshots` (polymorphic, one row per parent per user-local day).

## API

All under `/api/goalshq/*`, session or `tt_` token auth, user-scoped. See
`backend/docs/swagger/goalshq.js` / `/api-docs`. Key endpoints:

```
GET    /api/goalshq/config
GET    /api/goalshq/goals
GET    /api/goalshq/goals/:uid
PATCH  /api/goalshq/goals/:uid/settings
GET    /api/goalshq/goals/:uid/strategies
POST   /api/goalshq/goals/:uid/strategies
POST   /api/goalshq/goals/:uid/recompute
GET    /api/goalshq/strategies/:uid
PATCH  /api/goalshq/strategies/:uid
DELETE /api/goalshq/strategies/:uid
POST   /api/goalshq/strategies/:uid/projects            { project_uid, weight? }
DELETE /api/goalshq/strategies/:uid/projects/:projectUid
POST   /api/goalshq/strategies/:uid/recompute
GET|POST   /api/goalshq/:parentType(goal|strategy)/:uid/key-results
PATCH|DELETE /api/goalshq/key-results/:uid
GET|POST   /api/goalshq/:parentType(goal|strategy)/:uid/milestones
PATCH|DELETE /api/goalshq/milestones/:uid
```

## Progress rollup

`progress_mode` (per goal and per strategy) selects how a percentage is derived:

- `rollup_strategies` (goal default): importance-weighted mean of strategy %s + a
  "direct" bucket for projects/tasks attached straight to the goal.
- `rollup_projects` (strategy default): task-weighted mean of the linked projects'
  completion.
- `rollup_tasks`: one done/total bucket over all tasks below.
- `metric`: mean of key-result progress.
- `milestones`: achieved / total.
- `manual`: a number you set.

**Health** compares progress to elapsed time between `start_date` and
`target_date`: `on_track` (within 10 pts of expected), `at_risk` (within 25),
`off_track` (beyond), `no_data` (no target date / no linked work). Thresholds live
in `backend/modules/goalshq/operations/constants.js`.

Rollups are cached on the row and refreshed by (a) a cron sweep, (b)
recompute-on-read when stale, (c) an explicit `POST .../recompute`, and (d) any
mutation to the goal's strategies / metrics.

## Removing GoalsHQ entirely

1. Revert the `chore(goalshq): integration hooks` commit
   (`backend/app.js`, `frontend/App.tsx`, `frontend/components/Sidebar.tsx`) and
   drop the `goalshq` block from `public/locales/en/translation.json`.
2. `cd backend && npx sequelize-cli db:migrate:undo` six times (or run each
   migration's `down`).
3. Delete `backend/modules/goalshq/`, `frontend/components/GoalsHQ/`,
   `frontend/store/useGoalsHqStore.ts`, `frontend/utils/goalsHqService.ts`,
   `frontend/entities/GoalsHq.ts`, `frontend/components/Sidebar/SidebarGoalsHQ.tsx`,
   `backend/docs/swagger/goalshq.js`, `docs/goalshq/`, the goalshq tests, the CI
   workflow and `scripts/goalshq-verify.sh`.

## Design rationale

See [`adr/0001-isolation-architecture.md`](adr/0001-isolation-architecture.md).
