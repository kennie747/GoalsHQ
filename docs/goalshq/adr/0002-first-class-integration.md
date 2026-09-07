# ADR 0002 — GoalsHQ first-class integration (supersedes ADR 0001)

**Status:** accepted · **Date:** 2026-09-05

## Context

ADR 0001 built GoalsHQ as a strictly-additive, isolated add-on, optimized for
staying mergeable with `chrisvel/tududi` — no Sequelize associations into core
models, a separate frontend store, a self-hiding sidebar entry, and a literal
tripwire test asserting `backend/models/index.js` never mentions "goalshq".

That tradeoff has been deliberately abandoned. The fork's direction is now to
make Strategy (and the rest of GoalsHQ) a first-class peer of Area/Goal/
Project/Task — same depth of DB association, same store, same routing/sidebar
treatment — and to finish building out GoalsHQ's still-unbuilt features. This
is incompatible with staying cleanly mergeable with upstream.

## Decision

1. **Mergeability with upstream `chrisvel/tududi` is no longer a design
   constraint.** `git merge upstream/main` is expected to conflict
   non-trivially from this point forward, by design. Upstream tracking is now
   a deliberate, manual review-and-cherry-pick workflow — see
   `docs/goalshq/UPSTREAM_TRACKING.md` (Phase G, set up 2026-09-06; a dedicated
   `upstream-review` local branch tracks `upstream/main` for inspection only,
   never merged wholesale).
2. **GoalsHQ models are registered in `backend/models/index.js`** alongside
   core models, with real Sequelize associations (Goal ↔ Strategy, Strategy ↔
   Project as many-to-many via `goalshq_project_strategies`, and scoped
   polymorphic associations for KeyResult/Milestone/ProgressSnapshot). The
   former `backend/modules/goalshq/core/tududi.js` compat shim and the
   module-local `backend/modules/goalshq/models/index.js` registry have been
   removed.
3. **Strategy ↔ Project is now many-to-many.** The old unique-on-`project_id`
   constraint (ADR 0001 decision #4: "a project belongs to at most one
   strategy") is replaced with a composite unique index on
   `(strategy_id, project_id)` — see migration
   `20260905000001-goalshq-project-strategies-many-to-many.js`. A project can
   now serve multiple strategies at once. `linkProjectToStrategy()` no longer
   silently reassigns a project's strategy on re-link; an explicit
   `moveProjectLink` operation exists for that case.
4. **The GoalsHQ scheduler initializes from `backend/app.js`'s
   `startServer()`**, alongside `taskScheduler`/`caldavSyncScheduler`, instead
   of lazily self-bootstrapping from the first request.
5. **SQLite FK enforcement remains OFF** (deferred, not decided here — see
   below). `gcOrphans()` in `backend/modules/goalshq/operations/rollup.js`
   still performs compensating cleanup, now extended to also cover orphaned
   KeyResult/Milestone/ProgressSnapshot rows (polymorphic parent, no DB-level
   FK is possible there regardless of the PRAGMA).

## Deferred decisions

- **Enabling `PRAGMA foreign_keys = ON`** is out of scope for this pass — it
  is a cross-cutting change affecting every core table, not just GoalsHQ, and
  would require SQLite table-rebuild migrations. Track as its own future
  initiative if pursued.
- **Frontend de-isolation** (store, routing, sidebar, entities) is a separate
  phase — see the roadmap plan referenced from project memory / the
  implementation plan file for this effort.

## Consequence

`docs/goalshq/adr/0001-isolation-architecture.md` is kept as a historical
record of the original design and its rationale, but no longer describes the
current architecture. `docs/goalshq/README.md` and `INTEGRATION.md` were
rewritten (Phase G, 2026-09-06) to drop the isolated-add-on framing and
describe the current first-class structure — routes, data model, and
integration points as they actually stand after Phases A–F.
