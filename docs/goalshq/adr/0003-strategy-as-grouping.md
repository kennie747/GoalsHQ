# ADR 0003 — Strategy is a grouping concept, not a measured tier (revises ADR 0002)

**Status:** accepted · **Date:** 2026-09-08

## Context

ADR 0002 made Strategy a first-class **measured tier** in the rollup chain
`task → project → strategy → goal`: each strategy carried a `progress_mode`,
an `importance` weight, `manual_percent`, cached `percent`/`health`, its own
Key Results / Milestones / snapshots, and a health chip on every surface.

The fork owner's original intent for Strategy was different: a **grouping
bucket** — a named collection of the projects that belong together under one
broad approach ("Real Estate", "Systems Security"), both serving the same
Goal. It answers *"which approach is this project part of?"*, not *"how far
along is this approach?"*. Measurement (Key Results, Milestones) is a separate,
optional concern that belongs on the Goal (and optionally the Project), shown
**beside** task-completion progress, never blended into it.

The measured-tier design also produced concrete bugs: double-counting when a
project served multiple strategies, and a rollup that changed a goal's number
depending on how its projects happened to be grouped.

## Decision

1. **Strategy leaves the goal rollup chain.** The chain is now
   `task → project → goal`. A goal's execution % is the task-weighted mean of
   *all* its projects (+ direct goal tasks), independent of any grouping.

2. **Strategy = name · description · status · colour · optional Goal · many
   Projects.** `goalshq_strategies.goal_id` is now nullable ("No Goal",
   mirroring `goals.area_id`). The measurement columns (`kind`,
   `progress_mode`, `weight_by_priority`, `manual_percent`, `importance`,
   `horizon_label`, `start_date`, `target_date`) are dropped. `color` and
   `metrics_editable` are added.

3. **A strategy still shows one number: a grouping summary.**
   `cached_percent` / `cached_health` are kept but redefined as the *unweighted
   mean of the linked projects' execution %* (health = worst among them),
   always labelled "avg of N projects". It is display-only and is **never** an
   input to the goal.

4. **Execution vs Outcome, per Goal and per Project.** `goal/project settings`
   replace the single `progress_mode` selector with `metrics_enabled`
   (boolean). Execution % (task completion) is always computed; Outcome % (mean
   of Key Results + milestone ratio) is computed only when metrics are enabled.
   The two are cached separately (`cached_execution_*`, `cached_outcome_*`) and
   rendered side by side, never merged.

5. **Strategy Key Results / Milestones stay allowed but are display-only** —
   like task-parented KRs. A `metrics_editable` flag per strategy controls
   whether the editor is interactive. They never roll up.

6. **UI follows progressive disclosure** — the `ProjectModal` pattern
   (`expandedSections` + dot-badge icon row), extracted into
   `frontend/components/Shared/CollapsibleFields.tsx`. An entity with metrics
   disabled looks exactly as it did before; enabling reveals the minimum
   control; extra detail is always one more click.

## Consequences

- Migrations `20260908000001..4` apply the schema change and reparent any
  existing strategy-level KRs/milestones to their goal.
- `rollup.js` gains `recomputeStrategy` (goal-less strategies) and
  `recomputeProject` (goal-less projects with metrics).
- `moveProjectLink` and per-link `weight` are removed; Strategy↔Project is
  edited as a set (`PUT /goalshq/strategies/:uid/projects` and the symmetric
  project route).
- ADR 0002's "Strategy / Outcome tier" framing in `docs/goalshq/README.md` is
  rewritten accordingly.
