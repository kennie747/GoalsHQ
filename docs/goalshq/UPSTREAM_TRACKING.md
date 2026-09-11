# Upstream tracking (`chrisvel/tududi`)

This fork stopped optimizing for mergeability with upstream once GoalsHQ
became a first-class peer of Area/Goal/Project/Task (see
`adr/0002-first-class-integration.md`). `git merge upstream/main` is expected
to conflict non-trivially from that point forward, by design. This doc
replaces "stay mergeable" with a deliberate, manual review-and-port process.

## Workflow

- **Remote**: `upstream` → `https://github.com/chrisvel/tududi.git` (already
  added; check with `git remote -v` before re-adding).
- **Review branch**: `upstream-review` — a local branch tracking upstream's
  `main`, used only to inspect/cherry-pick from. **Never merge it into `main`
  or any working branch wholesale.** Refresh it with:
  ```bash
  git fetch upstream
  git branch -f upstream-review upstream/main
  ```
- **Cadence**: monthly, or whenever upstream cuts a release tag (`git fetch
  upstream --tags`). List what's new since the last reviewed SHA:
  ```bash
  git fetch upstream
  git log <last-reviewed-sha>..upstream/main --oneline
  ```
- **Log**: every review pass gets a row in the table below (or a batch note,
  for a pass covering several commits at once — see the first entry).

## Evaluation rubric

For each upstream commit (or batch), classify by:

1. **Touches an undiverged file** (this fork never edited it) → direct
   cherry-pick candidate: `git cherry-pick <sha>` onto a throwaway branch off
   `upstream-review`, test, then apply to the real branch.
2. **Touches a heavily-restructured file** — `backend/models/index.js`,
   `frontend/App.tsx`, `frontend/store/useStore.ts`,
   `frontend/components/Sidebar.tsx`, and (as of Phase F) individual
   `frontend/components/Sidebar/Sidebar*.tsx` files, `backend/modules/tasks/queries/query-builders.js`,
   `backend/modules/ai-assistant/service.js` — → **do not attempt
   `git cherry-pick`**; read the diff, port the *idea* by hand into this
   fork's current version of the file.
3. **GoalsHQ-relevant** (Goal/Project/Task scoring, AI assistant, Today page,
   carryover) → prioritize review regardless of which of the above two
   buckets it falls into — these are the commits most likely to matter for
   where this fork is actually going.
4. **Out of this fork's direction** (see below) → log as "not applicable" and
   don't re-review the same theme every pass.

### A standing "out of scope" theme

As of the first review pass (2026-09-05 → 2026-09-06 fetch), upstream has
moved decisively toward a **hosted multi-tenant SaaS product**: billing/Stripe,
PostgreSQL support alongside SQLite, structured ops logging, rate limiting,
self-service password reset, account erasure, multi-process coordination. This
fork is explicitly a self-hosted, single-user tool (see root `CLAUDE.md`) —
none of this is relevant to port, and it touches exactly the shared files
(`backend/models/index.js`, `backend/app.js`, `backend/config/config.js`)
this fork has also heavily diverged on for GoalsHQ. **Don't re-litigate "should
we adopt hosted mode" every pass** — revisit only if the fork's own direction
changes.

## Log

| Upstream SHA range | Date reviewed | Decision | Fork commit | Notes |
|---|---|---|---|---|
| `20266231..989823f5` (24 commits, `main`) | 2026-09-06 | **Batch-reviewed, 6 actionable, rest N/A** | _(not yet ported — logged for next session)_ | See breakdown below. |

### Breakdown of the first batch (`20266231..989823f5`)

**Actionable — review/port these:**

- `f41bc8c6`/`6806817a` *"exclude someday-tagged tasks from in-progress
  metrics count"* — touches `backend/modules/tasks/queries/metrics-computation.js`
  and `metrics-queries.js`. **Category 3 (GoalsHQ-relevant: Today-page task
  scoring) + category 2 (shared file this fork also touched in Phase E/C)** —
  real behavioral bug fix (a someday-tagged task shouldn't count as
  "in progress"), worth porting by hand rather than cherry-picking, since this
  fork's `query-builders.js`/`ai-assistant/service.js` changes sit near the
  same query surface.
- `a92185d2` *"show item counts next to section chevrons, add notes search
  filtering"* — touches `SidebarAreas.tsx`, `SidebarGoals.tsx`,
  `SidebarNotes.tsx`, etc. **Category 2** — this fork restructured
  `Sidebar.tsx` and added `SidebarStrategy.tsx`; port the "item count next to
  chevron" idea by hand into the current sidebar components rather than
  cherry-picking, to avoid silently reverting this fork's Strategy/Archive
  entries.
- `0c1b4142` *"detect Obsidian-style callouts past leading whitespace nodes"*
  — `MarkdownRenderer.tsx`/`calloutParser.ts`, undiverged. **Category 1** —
  direct cherry-pick candidate.
- `ff8b1d92` *"display actual configured upload size limit"* — task/project
  attachment components, undiverged. **Category 1** — direct cherry-pick
  candidate.
- `447ec373` + `bca751cc` *habit calendar month-alignment / first-day-of-week
  fixes* — `HabitDetails.tsx`, undiverged. **Category 1** — direct
  cherry-pick candidates (apply both together, same file).
- `3b19e870` *"remove duplicate success toast when saving note from inbox"*
  — `InboxItems.tsx`, undiverged. **Category 1** — direct cherry-pick
  candidate.

**Not applicable (hosted-mode/SaaS direction — see standing note above):**
`989823f5`, `b02a4cb7`, `b9f7674e`, `ad91c09e`, `831e0b69`, `98427cab`,
`d2094542`, `69505290`, `f458fc53`, `ef83b222`, `cec7a232`, `34e43357`,
`e2399985`, `afd591fb`, `8681ffd6`, `a49a923f` — billing, Postgres, ops
logging, rate limiting, auth/password-reset/account-erasure, release bumps.

**Next session should**: actually perform the 6 actionable ports/cherry-picks
above (none were applied yet in this pass — this log entry is the triage
only), then update this table's "Fork commit" column with the resulting SHA(s)
and advance the reviewed range to `989823f5` (or whatever `upstream/main`
has moved to by then).
