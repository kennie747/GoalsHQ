# Running & testing this fork (dev manual)

Personal runbook for the `kennie747/tududi` fork. Dev servers are pinned to
**frontend `:8081`** / **backend `:3003`** (upstream defaults are 8080 / 3002).

> Keep this file up to date — it is the single source of truth for how to start
> and test locally. Edit the relevant section whenever the procedure changes.

---

## TL;DR

```bash
git checkout main && git pull
npm install
npm run db:migrate
bash scripts/dev.sh          # frontend :8081, backend :3003
# open http://localhost:8081
```

Tests:

```bash
npm run lint && npm run build
npm run backend:test
npm run frontend:test
cd backend && npx cross-env NODE_ENV=test jest goalshq   # GoalsHQ backend only
bash scripts/e2e-goalshq.sh                              # GoalsHQ E2E
```

---

## 1. One-time setup

| Step | Command | Notes |
|---|---|---|
| Get latest `main` | `git checkout main && git pull` | includes the merged GoalsHQ (PR #1) |
| Install deps | `npm install` | single root `package.json` covers frontend + backend |
| Create `backend/.env` | see [§2](#2-backendenv) | git-ignored; holds the port + CORS config |
| Apply migrations | `npm run db:migrate` | creates the 6 `goalshq_*` tables in `backend/db/development.sqlite3` |
| Create a login | `cd backend && NODE_ENV=development node scripts/user-create.js you@example.com yourpassword true` | the dev DB starts empty; `true` = admin |

Node: this fork is developed on **Node 22** (matches CI). `nvm use 22` or equivalent.

---

## 2. `backend/.env`

Git-ignored. `backend/app.js` loads it via `dotenv` (cwd = `backend/`), so it is
picked up by `npm run backend:dev` and `bash scripts/dev.sh` — **not** by
`npm start` (which hard-codes 3002 in `backend/cmd/start-dev.sh`).

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3003
DB_FILE=db/development.sqlite3

FRONTEND_URL=http://localhost:8081
BACKEND_URL=http://localhost:3003

# The frontend origin MUST be listed or session cookies / CORS break.
TUDUDI_ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081,http://localhost:8080,http://127.0.0.1:8080

# Any 64-hex string; keeps you logged in across restarts.
TUDUDI_SESSION_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

GOALSHQ_ENABLED=true
ENABLE_EMAIL=false
DISABLE_TELEGRAM=true
PASSWORD_AUTH_ENABLED=true
```

Full list of accepted keys: `backend/.env.example`.

---

## 3. Starting the app

### Option A — one command (recommended)

```bash
bash scripts/dev.sh
```

- backend `:3003` (port + CORS from `backend/.env`, via `npm run backend:dev` = `nodemon app.js`)
- frontend `:8081` (webpack dev server; `FRONTEND_PORT` / `BACKEND_URL` exported by the script)
- Ctrl-C stops both.
- Open **http://localhost:8081**.

### Option B — two terminals

```bash
# terminal 1
cd backend && npm run backend:dev

# terminal 2
FRONTEND_PORT=8081 BACKEND_URL=http://localhost:3003 npm run frontend:dev
```

### Option C — upstream default ports (8080 / 3002)

```bash
npm start
```

`scripts/dev.sh` leaves `npm start` untouched.

---

## 4. Using GoalsHQ

1. Enabled by default. Sidebar → **Strategy** (just below Goals) → `/strategy`,
   or open a goal directly (`/goal/:uidSlug`) — its Strategy section is
   embedded right on the page. **Archive** (history of carryover decisions +
   goal progress) sits directly below Strategy in the sidebar.
2. GoalsHQ reads tududi's goals, so **create a Goal first** in tududi's own
   **Goals** section (give it a target date so health can be computed).
3. On the goal's detail page: add a **Strategy** inline, open it (`/strategy/:uidSlug`),
   **link projects** (multi-select), set **progress mode** + **importance**,
   add **key results** (optionally `auto_source: tasks_done_count`) /
   **milestones** (with a manual **Expand into task** button).
4. Progress rolls up task → project → strategy → goal automatically (cron every
   15 min, on page load if stale, or **Recompute** /
   `POST /api/goalshq/goals/:uid/recompute`).

Toggle off entirely: `GOALSHQ_ENABLED=false` in `backend/.env` → `features.goalshq_enabled`
comes back `false` from `/api/current_user`, the sidebar entries disappear, and
`/api/goalshq/*` returns 404. The `/strategy` and `/archive` routes themselves
stay registered either way (matching how `/goal/:uidSlug` doesn't redirect when
empty) — only the sidebar links and API responses are gated.

---

## 5. Tests

All test commands use their **own** ports / databases — the `:8081` / `:3003`
dev change does not affect them.

| Scope | Command |
|---|---|
| Lint (frontend + backend) | `npm run lint` |
| Typecheck + build | `npm run build` |
| Backend suite (full) | `npm run backend:test` |
| Frontend suite (full) | `npm run frontend:test` |
| GoalsHQ backend only | `cd backend && npx cross-env NODE_ENV=test jest goalshq` |
| GoalsHQ E2E | `bash scripts/e2e-goalshq.sh` (starts its own servers on :3310 / :4180) |
| Full E2E | `npm run test:ui` — ⚠️ **30 pre-existing failures** in `caldav-client.spec.ts` + `inbox.spec.ts`, unrelated to GoalsHQ (reproducible on the pre-GoalsHQ commit); this repo's CI does not run the full suite |
| Coverage | `npm run test:coverage` |

CI mirrors this: `.github/workflows/ci.yml` (`test` job) + `.github/workflows/pr-checks.yml`
(`frontend-tests`, `goalshq`, `e2e`, `all-green`). `main` is branch-protected to
require `test` + `all-green`.

---

## 6. Database

| Task | Command |
|---|---|
| Apply pending migrations | `npm run db:migrate` |
| Migration status | `cd backend && NODE_ENV=development node scripts/db-status.js` |
| Wipe + recreate schema (**drops all data**) | `npm run db:reset` or `cd backend && NODE_ENV=development node scripts/db-init.js` |
| Seed dev data | `npm run db:seed` |

Dev DB file: `backend/db/development.sqlite3` (plus `-wal` / `-shm` sidecars).

---

## 7. Changing the ports (updating this setup)

Everything is env-driven; there are no source patches to maintain.

| Want | Change |
|---|---|
| Different backend port | `PORT=` in `backend/.env` (+ update `BACKEND_URL` there and in `scripts/dev.sh`) |
| Different frontend port | `FRONTEND_PORT=` in `scripts/dev.sh` (or export before `npm run frontend:dev`) |
| Allow another frontend origin | add it to `TUDUDI_ALLOWED_ORIGINS` in `backend/.env` |
| Point frontend at a different backend | `BACKEND_URL=` in `scripts/dev.sh` |

After changing a frontend origin, the matching `http://<host>:<port>` **must**
be in `TUDUDI_ALLOWED_ORIGINS` or login will 401 / CORS-fail.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend exits immediately, `"NODE_ENV should be one of ..."` | `NODE_ENV` not set — ensure `backend/.env` has `NODE_ENV=development` and you started via `backend:dev` / `scripts/dev.sh` |
| Login returns 401 through the proxy, or "CORS" errors in the console | frontend origin missing from `TUDUDI_ALLOWED_ORIGINS` in `backend/.env` |
| `/api/*` calls 404 / connection refused from the frontend | `BACKEND_URL` in `scripts/dev.sh` doesn't match the backend `PORT` |
| Port already in use | `lsof -ti tcp:8081 tcp:3003 \| xargs -r kill` |
| Strategy/Archive sidebar items missing | `GOALSHQ_ENABLED` is `false` — check `features.goalshq_enabled` on `GET /api/current_user` |
| GoalsHQ percentages all `—` / `no_data` | no linked work yet, or the goal has no `target_date`; hit **Recompute** |
| Migrations fail on a fresh DB | run `npm run db:init` first (creates base tables), then `npm run db:migrate` |
| Playwright: "does not support chromium on ubuntu26.04" (sandbox only) | `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` + `npx playwright install chromium`; CI (ubuntu-latest) is unaffected |

---

## 9. Contributing changes back

`main` is branch-protected (requires `test` + `all-green`, strict). Workflow:

```bash
git checkout main && git pull
git checkout -b feat/my-thing
# ... work, commit ...
git push -u origin feat/my-thing
gh pr create --base main --fill        # (Windows gh: "/mnt/c/Program Files/GitHub CLI/gh.exe")
```

Pushing `.github/workflows/*` needs a token with the `workflow` scope
(`gh auth refresh -s workflow`).

Keep the fork current with upstream by **merging** (not rebasing):

```bash
git fetch upstream && git checkout main && git merge upstream/main
bash scripts/goalshq-verify.sh         # sanity gate after touching GoalsHQ-adjacent shared files
```
