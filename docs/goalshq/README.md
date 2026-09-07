# GoalsHQ (first-class)

GoalsHQ is the strategic-execution layer of this fork — **Strategy** is a
first-class peer of Area/Goal/Project/Task: same depth of DB association,
same frontend store pattern, same top-level routing and sidebar treatment.
It is no longer a removable add-on (see `adr/0001-isolation-architecture.md`
for that original design and `adr/0002-first-class-integration.md` for why
it was abandoned).

It adds:

- a **Strategy / Outcome tier** between a Goal and its Projects
  (`Goal → Strategy → Project → Task`, plus a direct `Goal → Project` bucket,
  with Strategy ↔ Project genuinely many-to-many);
- **measurable goals, strategies, projects, and tasks** — key results
  (with optional `auto_source: tasks_done_count` automation), milestones
  (with a manual "Expand into task" action), importance, health;
- an automatic **progress rollup** (task → project → strategy → goal) with
  daily snapshots for trend lines;
- a **carryover/rescheduling** review queue and history archive for
  overdue tasks (resurface / reschedule / drop);
- **AI daily-brief context** that reads real strategy/KR/carryover data.

> **Running & testing locally:** see [`RUNNING.md`](RUNNING.md) — the dev runbook
> (frontend `:8081` / backend `:3003`, `bash scripts/dev.sh`, test commands,
> troubleshooting).
>
> **Tracking upstream `chrisvel/tududi`:** see
> [`UPSTREAM_TRACKING.md`](UPSTREAM_TRACKING.md) — this fork is no longer
> designed to stay mergeable; upstream commits are reviewed and manually
> cherry-picked/ported on a monthly cadence instead.

## Where it lives

| Area | Path |
|---|---|
| Backend module | `backend/modules/goalshq/` (models registered in `backend/models/index.js` with real associations) |
| Carryover module | `backend/modules/tasks/carryover/` |
| Migrations | `backend/migrations/20260902*-goalshq-*.js`, `20260905*-goalshq-*.js`, `20260905000003-create-task-carryover-events.js` |
| Backend tests | `backend/tests/unit/goalshq/`, `backend/tests/integration/goalshq*.test.js`, `backend/tests/integration/task-carryover.test.js` |
| Swagger | `backend/docs/swagger/goalshq.js` |
| Frontend | `frontend/components/Strategy/`, `frontend/components/Archive/`, `frontend/store/useStore.ts` (`strategiesStore` slice), `frontend/utils/goalsHqService.ts`, `frontend/utils/carryoverService.ts`, `frontend/entities/{Strategy,KeyResult,Milestone,GoalSettings,ProgressSnapshot,CarryoverEvent}.ts` |
| Sidebar | `frontend/components/Sidebar/SidebarStrategy.tsx` (renders both "Strategy" and "Archive" entries, just below Goals) |
| Routes | `/strategy`, `/strategy/:uidSlug`, `/archive`, Strategy section embedded in `/goal/:uidSlug` (`GoalDetails.tsx`) |
| i18n | `public/locales/en/translation.json` → `goalshq.*`, `carryover.*`, `archive.*` |
| Integration | `backend/app.js`, `frontend/App.tsx`, `frontend/components/Sidebar.tsx` — ordinary edits, not isolated hooks (see `INTEGRATION.md`) |

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `GOALSHQ_ENABLED` | `true` | Set `false` to hide the UI + disable `/api/goalshq/*` |
| `GOALSHQ_RECOMPUTE_CRON` | `*/15 * * * *` | Rollup sweep schedule |
| `GOALSHQ_STALE_MINUTES` | `20` | Recompute-on-read threshold |
| `GOALSHQ_GC_CRON` | `30 3 * * *` | Nightly orphan GC |
| `CARRYOVER_CLASSIFY_CRON` | `0 */4 * * *` | Overdue-task classification sweep |
| `CARRYOVER_DROP_THRESHOLD_DAYS` | `14` | Days overdue (unlinked, low-priority) before classifying as "drop" |

Zero config required — every value has a sane default.

## Data model

`goalshq_strategies`, `goalshq_project_strategies` (many-to-many), `goalshq_goal_settings`,
`goalshq_project_settings`, `goalshq_key_results` (polymorphic: goal/strategy/project/task,
with `auto_source`), `goalshq_milestones` (polymorphic: goal/strategy/project),
`goalshq_progress_snapshots` (polymorphic, one row per parent per user-local day),
plus `task_carryover_events` (one row per overdue episode, own table since carryover
rows are updated on review rather than append-only).

Real Sequelize associations exist from `Goal`/`Project`/`Task` into these tables
(see `backend/models/index.js`) — this is not a bolt-on schema.

## API

All under `/api/goalshq/*` and `/api/tasks/carryover*`, session or `tt_` token
auth, user-scoped. See `backend/docs/swagger/goalshq.js` / `/api-docs` for the
full, current list. Representative endpoints:

```
GET    /api/goalshq/goals
GET    /api/goalshq/goals/:uid
PATCH  /api/goalshq/goals/:uid/settings
POST   /api/goalshq/goals/:uid/strategies
POST   /api/goalshq/goals/:uid/recompute
GET|PATCH|DELETE /api/goalshq/strategies/:uid
POST   /api/goalshq/strategies/:uid/projects            { project_uid, weight? }
DELETE /api/goalshq/strategies/:uid/projects/:projectUid
GET    /api/goalshq/projects/:uid
PATCH  /api/goalshq/projects/:uid/settings
GET|POST     /api/goalshq/:parentType(goal|strategy|project|task)/:uid/key-results
PATCH|DELETE /api/goalshq/key-results/:uid
GET|POST     /api/goalshq/:parentType(goal|strategy|project)/:uid/milestones
PATCH|DELETE /api/goalshq/milestones/:uid
POST         /api/goalshq/milestones/:uid/expand        (creates a linked task)
GET    /api/tasks/carryover                             (pending review queue)
GET    /api/tasks/carryover/history                     (full archive, reviewed or not)
POST   /api/tasks/carryover/:id/accept
POST   /api/tasks/carryover/:id/override
```

## Progress rollup

`progress_mode` (per goal, strategy, and project) selects how a percentage is derived:

- `rollup_strategies` (goal default): importance-weighted mean of strategy %s + a
  "direct" bucket for projects/tasks attached straight to the goal.
- `rollup_projects` (strategy default): task-weighted mean of the linked projects'
  completion (a project in `metric`/`milestones` mode contributes its own
  measured percent instead of its task percent).
- `rollup_tasks` (project default): one done/total weighted bucket over all
  tasks below, subtasks included.
- `metric`: mean of key-result progress (`aggregateKeyResults`); a KR with
  `auto_source: tasks_done_count` has its `current_value` auto-set from the
  same batched task rows each pass, no separate query.
- `milestones`: achieved / total.
- `manual`: a number you set.

**Health** compares progress to elapsed time between `start_date`/`created_at`
and `target_date`: `on_track` (within 10 pts of expected), `at_risk` (within 25),
`off_track` (beyond), `no_data` (no target date / no linked work). Thresholds live
in `backend/modules/goalshq/operations/constants.js`.

Rollups are cached on the row and refreshed by (a) a cron sweep, (b)
recompute-on-read when stale, (c) an explicit `POST .../recompute`, and (d) any
mutation to the goal's strategies / metrics.

## Design rationale

See [`adr/0001-isolation-architecture.md`](adr/0001-isolation-architecture.md)
for the original (abandoned) isolated-add-on design, and
[`adr/0002-first-class-integration.md`](adr/0002-first-class-integration.md)
for why and how it changed.
