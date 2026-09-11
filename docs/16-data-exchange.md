# Data Exchange — Spreadsheet Import & Export

Human-editable bulk import/export of a user's own data as **XLSX** (multi-sheet
workbook) or **CSV** (one entity per file). Complements the JSON backup
(`docs/backups.md`), which stays the format for full-fidelity round-trips.

- **Feature flag:** `FF_ENABLE_DATA_EXCHANGE=true` (also surfaced in
  `GET /api/feature-flags` as `dataExchange`, which gates the navbar link).
- **Backend module:** `backend/modules/data-exchange/`
- **Frontend:** route `/data-exchange`, `frontend/components/DataExchange/`,
  `frontend/utils/dataExchangeService.ts`

## How it works

The whole feature is driven by a **resource registry**
(`core/registry.js`). Each entity is one declarative descriptor: its model,
sheet name, columns (with cell⇄DB transforms), `dependsOn` order, natural key,
and which columns are foreign-key references. Adding an entity to
import/export = adding a descriptor; the engine is entity-agnostic.

Currently registered: `tags`, `areas`, `goals`, `projects`, `tasks`, `notes`,
`inbox_items`, and (when GoalsHQ is enabled) `goalshq_strategies`,
`goalshq_key_results`, `goalshq_key_result_entries`, `goalshq_milestones`,
`goalshq_records`.

Notes worth knowing:
- Note titles are optional and not unique. Two rows that resolve to the same
  (project, blank-or-duplicate title) natural key are **not** silently merged —
  the second is reported as an error asking for a `uid` to disambiguate.
- Inbox rows have no foreign-key columns (`suggested_type`, `parsed_tags`, …
  are app-derived and intentionally left out of the sheet); `content` is
  required, `source` defaults to `manual` when left blank.
- **GoalsHQ polymorphic parents** (Key Results, Milestones, Records attach to
  a goal, strategy, project, or — for Key Results only — a task) get two
  columns: `parent_type` (enum) and `parent` (the parent's name). `parent`'s
  target resource is resolved from `parent_type` on the same row, via a
  `ref()` column whose "resource" is a function of the row's other cells
  instead of a fixed string — the one place the registry needs that. These
  sheets are only offered when `GOALSHQ_ENABLED !== 'false'`.
- A Key Result's `parent_key_result` column (the KR tree) and a Record's
  `counts_toward_kr` column both point at `goalshq_key_results`, so KRs must
  be imported in the same request (or already exist) for those links to
  resolve — put `Key Results` and `Records` in the same workbook/scope.
- Strategy↔Project is many-to-many in the app (a project can serve several
  strategies) but is **not yet editable from the sheet** — link projects to a
  strategy from the UI for now; a `projects` multi-value column is a natural
  follow-up once the engine grows generic multi-reference columns (it already
  has the single-value `tags` collection column as a precedent).

### Endpoints (all under `/api`, all user-scoped)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/data-exchange/resources` | Registry metadata (columns, enums) for the UI |
| GET  | `/data-exchange/template?format=xlsx&scopes=all` | Empty styled workbook (README + Enums sheets, dropdowns) |
| GET  | `/data-exchange/export?format=xlsx\|csv&scopes=...` | Same, populated with the user's rows |
| POST | `/data-exchange/preview` (`file`) | Validate + return a plan; **no writes** |
| POST | `/data-exchange/commit` (`file` + options) | Apply the plan in one transaction |

`scopes` is a comma list of resource keys or `all`. `format=csv` requires
exactly one scope.

### Row identity & references

- Every sheet has a **`uid`** column. Blank ⇒ create; present & known ⇒ update;
  present & unknown ⇒ create (keeping that uid only if it is globally unused —
  a sheet can never address another user's row).
- No uid ⇒ match on the **natural key** (name/title within parent scope);
  match ⇒ update, else create.
- Parent columns (`area`, `goal`, `project`, `parent_task`) hold the parent's
  **name**, or `uid:<uid>` to disambiguate. `tags` is comma-separated;
  unknown tags are auto-created.

### Import modes

- **merge** (default): create + update only.
- **sync**: for the ticked scopes, rows in the DB but missing from the sheet
  are archived (tasks/projects → status) or destroyed (`syncDelete`). The
  preview reports `pendingDeletes`; `commit` must echo the same count in
  `confirmDeletes` or it is rejected (409).

Re-importing an unmodified export is a no-op (field-level diffing).

### Engine (`core/engine.js`)

`run({ commit })` executes the identical path for preview (`commit:false`,
synthetic ids, no writes) and commit (`commit:true`, one
`sequelize.transaction()`). Resources are processed in topological order;
self-references (`parent_task_id`) are wired in a deferred second pass, mirroring
`backend/services/backupService.js`.

### Job history

`GET /data-exchange/jobs?limit=20` lists the user's own recent exports and
import commits (`backend/models/data_exchange_job.js`, table
`data_exchange_jobs`, migration `20260911023540-create-data-exchange-jobs.js`).
Logging is best-effort (`core/jobs.js`) and never blocks or fails the
export/import it describes. **Previews are never logged** — they are
read-only and disposable by design. A failed commit (row errors, or a stale
`confirmDeletes`) is logged with `status: 'error'` and `error_message`, not
silently dropped. Shown as a "Recent activity" panel on the frontend page.

## Tests

- `backend/tests/integration/data-exchange.test.js` — round-trip idempotency,
  create/update, preview-is-read-only, unresolved refs (including a bad
  polymorphic `parent_type`), sync + stale-confirm, cross-tenant isolation,
  notes/inbox edge cases, GoalsHQ polymorphic parents + KR self-reference +
  cross-sheet KR link, job history (export/import/failure logging, HTTP).
- `e2e/tests/data-exchange.spec.ts` — download template → fill in Areas/
  Projects/Tasks → preview → apply → shows up in history and via the app's
  own API; re-importing an unmodified export is a no-op. Run in isolation
  with `bash scripts/e2e-data-exchange.sh` (mirrors
  `scripts/e2e-goalshq.sh`); wired into `.github/workflows/pr-checks.yml` as
  the `data-exchange-e2e` job.
