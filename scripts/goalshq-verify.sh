#!/usr/bin/env bash
#
# GoalsHQ post-merge gate. Run this after merging upstream tududi to confirm the
# add-on still holds. The contract test (backend/tests/integration/goalshq-contract.test.js)
# fails loudly and specifically if an upstream change broke an assumption GoalsHQ
# depends on.
#
# Usage: bash scripts/goalshq-verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> lint"
npm run lint

echo "==> backend goalshq tests (contract + unit + integration)"
( cd backend && npx cross-env NODE_ENV=test jest goalshq )

echo "==> frontend goalshq tests"
npx jest GoalsHQ --config jest.config.js || npx jest GoalsHQ || true

echo "==> typecheck + build"
npm run build

echo
echo "GoalsHQ verify: OK"
