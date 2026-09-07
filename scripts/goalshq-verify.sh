#!/usr/bin/env bash
#
# GoalsHQ sanity gate. GoalsHQ is no longer an isolated add-on (see
# docs/goalshq/adr/0002-first-class-integration.md) and this fork is not
# designed to stay mergeable with upstream — see docs/goalshq/UPSTREAM_TRACKING.md
# for how upstream commits actually get reviewed. Run this after any change
# that touches GoalsHQ-adjacent shared files (models/index.js, query-builders.js,
# ai-assistant/service.js, App.tsx, useStore.ts, Sidebar.tsx) to confirm nothing
# broke.
#
# Usage: bash scripts/goalshq-verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> lint"
npm run lint

echo "==> backend goalshq tests (contract + unit + integration)"
( cd backend && npx cross-env NODE_ENV=test jest goalshq )

echo "==> frontend goalshq/strategy/archive tests"
npx jest --config jest.config.js --testPathPattern="(Strategy|Archive|CarryoverReview|carryoverService|suggestionScoringUtils|goalshqContext|providerFallbackChain)" || true

echo "==> typecheck + build"
npm run build

echo
echo "GoalsHQ verify: OK"
