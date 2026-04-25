#!/usr/bin/env bash
# Apply onboarding DB schema. Idempotent.
set -euo pipefail

# Load env from repo root (script lives in repo/scripts/, repo root is its parent).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${ONBOARDING_DB_USER:=onboarding}"
: "${ONBOARDING_DB_PASSWORD:=onboarding}"
: "${ONBOARDING_DB_PORT:=5544}"
: "${ONBOARDING_DB_NAME:=onboarding}"

cd apps/onboarding
if [ ! -d node_modules ]; then
  echo "[migrate-onboarding] installing node_modules…"
  npm ci || npm install
fi

export POSTGRES_URL="postgres://${ONBOARDING_DB_USER}:${ONBOARDING_DB_PASSWORD}@localhost:${ONBOARDING_DB_PORT}/${ONBOARDING_DB_NAME}"

echo "[migrate-onboarding] running migrations…"
npx tsx db/migrate.ts
