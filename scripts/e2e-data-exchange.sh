#!/usr/bin/env bash
#
# Runs ONLY the Data Exchange Playwright spec
# (e2e/tests/data-exchange.spec.ts) against a freshly-started backend +
# frontend. Mirrors scripts/e2e-goalshq.sh — see that file for why the full
# e2e suite (npm run test:ui) is not run by this repo's CI.
set -euo pipefail

FRONTEND_PORT="${FRONTEND_PORT:-4181}"
BACKEND_PORT="${BACKEND_PORT:-3311}"
BACKEND_HEALTH="http://127.0.0.1:${BACKEND_PORT}/api/health"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

rm -f backend/db/test.sqlite3

echo "==> starting backend (test)"
( cd backend && \
  NODE_ENV=test PORT=$BACKEND_PORT HOST=127.0.0.1 DB_FILE=db/test.sqlite3 \
  TUDUDI_USER_EMAIL="${E2E_EMAIL:-test@tududi.com}" \
  TUDUDI_USER_PASSWORD="${E2E_PASSWORD:-password123}" \
  FF_ENABLE_DATA_EXCHANGE=true GOALSHQ_ENABLED=true SEQUELIZE_LOGGING=false \
  ./cmd/start.sh ) &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "${FRONTEND_PID:-}" 2>/dev/null || true
  if command -v lsof >/dev/null 2>&1; then
    for p in $FRONTEND_PORT $BACKEND_PORT; do
      pids=$(lsof -ti tcp:$p 2>/dev/null || true)
      [ -n "$pids" ] && kill $pids 2>/dev/null || true
    done
  fi
  rm -f "$ROOT_DIR/backend/db/test.sqlite3"
}
trap cleanup EXIT INT TERM

echo "==> waiting for backend"
for i in $(seq 1 90); do
  curl -sf "$BACKEND_HEALTH" >/dev/null && { echo "backend ready"; break; }
  sleep 1
  [ "$i" -eq 90 ] && { echo "backend did not start"; exit 1; }
done

echo "==> starting frontend"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" FRONTEND_PORT=$FRONTEND_PORT \
  FRONTEND_HOST=127.0.0.1 FRONTEND_ORIGIN="$FRONTEND_URL" \
  npm run frontend:dev &
FRONTEND_PID=$!

echo "==> waiting for frontend"
for i in $(seq 1 120); do
  curl -sf "$FRONTEND_URL" >/dev/null && { echo "frontend ready"; break; }
  sleep 1
  [ "$i" -eq 120 ] && { echo "frontend did not start"; exit 1; }
done

echo "==> running Data Exchange e2e"
APP_URL="$FRONTEND_URL" \
  E2E_EMAIL="${E2E_EMAIL:-test@tududi.com}" \
  E2E_PASSWORD="${E2E_PASSWORD:-password123}" \
  CI=true \
  npx playwright test data-exchange \
    --config="${PW_CONFIG:-e2e/playwright.config.ts}" \
    --project=Chromium
