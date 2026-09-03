#!/usr/bin/env bash
#
# Local dev launcher pinned to frontend :8081 / backend :3003.
# Backend port + CORS come from backend/.env (loaded by app.js via dotenv);
# the frontend dev server is configured through the env vars exported here.
#
#   bash scripts/dev.sh
#
# Leaves `npm start` (8080/3002) untouched.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export FRONTEND_PORT="${FRONTEND_PORT:-8081}"
export FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
export BACKEND_URL="${BACKEND_URL:-http://localhost:3003}"
export FRONTEND_ORIGIN="http://localhost:${FRONTEND_PORT}"

cleanup() {
  echo
  echo "Stopping frontend and backend..."
  pids="$(jobs -p || true)"
  [ -n "$pids" ] && { kill $pids 2>/dev/null || true; wait $pids 2>/dev/null || true; }
}
trap cleanup INT TERM EXIT

echo "Backend  -> http://localhost:3003  (backend/.env: PORT=3003)"
echo "Frontend -> http://localhost:${FRONTEND_PORT}"
echo

# backend:dev = `cd backend && nodemon app.js` — honours backend/.env (PORT=3003)
npm run backend:dev &

# frontend:dev = webpack serve — reads FRONTEND_PORT / BACKEND_URL from the env
npm run frontend:dev &

wait
