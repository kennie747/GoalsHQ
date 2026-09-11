# GoalsHQ (first-class)

GoalsHQ is the strategic-execution layer of this fork — **Strategy** is a
first-class peer of Area/Goal/Project/Task: same depth of DB association,
same frontend store pattern, same top-level routing and sidebar treatment.
It is no longer a removable add-on (see `adr/0001-isolation-architecture.md`
for the original isolated design, `adr/0002-first-class-integration.md` for
the first-class shift, and **`adr/0003-strategy-as-grouping.md`** for the
current model, in which Strategy is a *grouping bucket* rather than a measured
tier).

It adds:

- **Strategy** — a grouping bucket: name · description · status · colour · an
  optional Goal · any number of Projects (many-to-many). It shows one number,
  a *grouping summary* = the plain average of its linked projects' execution %
  ("avg of N projects"), which is **display-only and never feeds the goal**.
- **Execution vs Outcome**, per Goal and per Project. Execution % (task
  completion) is always computed; Outcome % (Key Results + milestone ratio) is
  opt-in via `metrics_enabled` and shown *beside* execution, never blended.
- **measurable goals & projects** — key results (with
  `auto_source: tasks_done_count`), milestones (with "Expand into task"),
  health; Key Results / Milestones may also be attached to a Strategy as
  display-only context.
- an automatic **progress rollup** (`task → project → goal`) with daily
  execution + outcome snapshots for trend lines;
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

`goalshq_strategies` (grouping bucket: `name, description, status, color,
metrics_editable`, nullable `goal_id`, plus `cached_percent/health` = the
grouping-summary average of linked projects), `goalshq_project_strategies`
(many-to-many), `goalshq_goal_settings` / `goalshq_project_settings`
(`metrics_enabled` + `cached_execution_*` / `cached_outcome_*`),
`goalshq_key_results` (polymorphic: goal/strategy/project/task, with
`auto_source`), `goalshq_milestones` (polymorphic: goal/strategy/project),
`goalshq_progress_snapshots` (polymorphic, `kind` = execution|outcome, one row
per parent per kind per user-local day), plus `task_carryover_events`.

Real Sequelize associations exist from `Goal`/`Project`/`Task` into these tables
(see `backend/models/index.js`) — this is not a bolt-on schema.

## API

All under `/api/goalshq/*` and `/api/tasks/carryover*`, session or `tt_` token
auth, user-scoped. See `backend/docs/swagger/goalshq.js` / `/api-docs` for the
full, current list. Representative endpoints:

```
GET    /api/goalshq/goals
GET    /api/goalshq/goals/:uid
PATCH  /api/goalshq/goals/:uid/settings                  { metrics_enabled?, start_date?, manual_percent? }
POST   /api/goalshq/goals/:uid/recompute
GET    /api/goalshq/strategies                           (all, incl. goal-less)
POST   /api/goalshq/strategies                           { name, description?, color?, status?, goal_uid?, project_uids? }
POST   /api/goalshq/goals/:uid/strategies                (alias — pins the goal)
GET|PATCH|DELETE /api/goalshq/strategies/:uid            (PATCH goal_uid: null detaches)
PUT    /api/goalshq/strategies/:uid/projects             { project_uids: [...] }  (replace the set)
POST   /api/goalshq/strategies/:uid/projects             { project_uid }
DELETE /api/goalshq/strategies/:uid/projects/:projectUid
GET    /api/goalshq/projects/:uid
PATCH  /api/goalshq/projects/:uid/settings               { metrics_enabled?, manual_percent? }
PUT    /api/goalshq/projects/:uid/strategies             { strategy_uids: [...] }
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

The chain is `task → project → goal`. Strategy is **not** in it.

- **Goal / Project execution %** — always computed. Project execution = a
  done/total weighted task bucket (subtasks included), or `manual_percent` if
  set. Goal execution = task-weighted mean of its projects + a direct bucket
  for goal tasks with no project.
- **Goal / Project outcome %** — only when `metrics_enabled`. The mean of
  whichever of {Key Result mean, milestone achieved/total} is defined. A KR
  with `auto_source: tasks_done_count` has its `current_value` auto-set from
  the same batched task rows each pass.
- **Strategy grouping summary** — the unweighted mean of its linked projects'
  execution %; health = the worst health among them. Display-only, never an
  input to the goal.

**Health** compares progress to elapsed time between `start_date`/`created_at`
and `target_date`: `on_track` (within 10 pts of expected), `at_risk` (within 25),
`off_track` (beyond), `no_data` (no target date / no linked work). Thresholds live
in `backend/modules/goalshq/operations/constants.js`.

Rollups are cached (`cached_execution_*` / `cached_outcome_*` on goal/project
settings, `cached_percent`/`cached_health` on the strategy row) and refreshed by
(a) a cron sweep, (b) recompute-on-read when stale, (c) an explicit
`POST .../recompute`, and (d) any mutation to a goal's strategies / metrics /
project links. `recomputeStrategy` / `recomputeProject` handle goal-less
strategies and goal-less metric-enabled projects.

## Design rationale

- [`adr/0001-isolation-architecture.md`](adr/0001-isolation-architecture.md) —
  original isolated add-on (abandoned).
- [`adr/0002-first-class-integration.md`](adr/0002-first-class-integration.md) —
  the first-class shift.
- [`adr/0003-strategy-as-grouping.md`](adr/0003-strategy-as-grouping.md) —
  Strategy as a grouping bucket + execution/outcome split (current).
