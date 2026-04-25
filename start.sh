#!/usr/bin/env bash
# start.sh — idempotent bring-up for the Mercato Sandboxes POC.
#
# Steps (per SPEC.md §5):
#   1. compose up coder + both postgres, wait for healthchecks
#   2. scripts/bootstrap-coder.sh   (task #4)  - mints admin API token -> .runtime/coder-admin-token
#   3. scripts/build-workspace-image.sh (task #2) - builds mercato-workspace:latest
#   4. scripts/push-template.sh     (task #3)  - pushes Coder template, writes .runtime/coder-template-id
#   5. scripts/migrate-onboarding.sh (task #5) - applies onboarding DB schema
#   6. (task #5) build + start onboarding container
#   7. print URLs
#
# Scripts that don't yet exist are skipped with a [skip] notice — this script
# is meant to remain runnable as the project is built up task by task.

set -euo pipefail

cd "$(dirname "$0")"

# docker compose reads .env natively. We only re-read the few values needed
# for printing URLs at the end (avoids shell-parsing issues with quoted values).
read_env() {
  local key="$1" default="$2"
  local val
  if [ -f .env ]; then
    val=$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//') || true
  fi
  echo "${val:-$default}"
}

CODER_HTTP_PORT=$(read_env CODER_HTTP_PORT 7080)
CODER_FIRST_USER_EMAIL=$(read_env CODER_FIRST_USER_EMAIL admin@local.dev)
CODER_FIRST_USER_PASSWORD=$(read_env CODER_FIRST_USER_PASSWORD 'Sup3rSecret!')
ONBOARDING_HTTP_PORT=$(read_env ONBOARDING_HTTP_PORT 3000)
ONBOARDING_DB_PORT=$(read_env ONBOARDING_DB_PORT 5544)
ONBOARDING_DB_USER=$(read_env ONBOARDING_DB_USER onboarding)
ONBOARDING_DB_PASSWORD=$(read_env ONBOARDING_DB_PASSWORD onboarding)
ONBOARDING_DB_NAME=$(read_env ONBOARDING_DB_NAME onboarding)

mkdir -p .runtime

echo "[start] bringing up control-plane services (coder + postgres)…"
docker compose up -d postgres-coder postgres-onboarding coder

echo "[start] waiting for services to become healthy (timeout: 120s)…"
deadline=$(( $(date +%s) + 120 ))
services=(postgres-coder postgres-onboarding coder)
while :; do
  all_ok=true
  for svc in "${services[@]}"; do
    cid=$(docker compose ps -q "$svc" 2>/dev/null || true)
    if [ -z "$cid" ]; then
      all_ok=false
      break
    fi
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "unknown")
    if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
      all_ok=false
      break
    fi
  done
  if $all_ok; then
    echo "[start] all control-plane services healthy."
    break
  fi
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "[start] ERROR: timed out waiting for services to be healthy" >&2
    docker compose ps
    exit 1
  fi
  sleep 2
done

# --- 2. bootstrap Coder admin token (task #4) -------------------------------
bash scripts/bootstrap-coder.sh

# --- 3. build workspace image (task #2) -------------------------------------
if [ -f scripts/build-workspace-image.sh ]; then
  bash scripts/build-workspace-image.sh
else
  echo "[skip] scripts/build-workspace-image.sh not yet implemented (task #2)"
fi

# --- 4. push Coder template (task #3) ---------------------------------------
if [ -f scripts/push-template.sh ]; then
  bash scripts/push-template.sh
else
  echo "[skip] scripts/push-template.sh not yet implemented (task #3)"
fi

# --- 5. onboarding DB migrations (task #5) ----------------------------------
if [ -f scripts/migrate-onboarding.sh ]; then
  bash scripts/migrate-onboarding.sh
else
  echo "[skip] scripts/migrate-onboarding.sh not yet implemented (task #5)"
fi

# --- 6. onboarding app start (task #5) --------------------------------------
# Will be added once apps/onboarding/ exists and is wired into docker-compose.yml.

# --- 7. print URLs ----------------------------------------------------------
cat <<EOF

[start] up.

  Coder admin:  http://localhost:${CODER_HTTP_PORT}
                (admin: ${CODER_FIRST_USER_EMAIL} / ${CODER_FIRST_USER_PASSWORD})
  Onboarding:   http://localhost:${ONBOARDING_HTTP_PORT}   (added in task #5)

  Onboarding DB: postgres://${ONBOARDING_DB_USER}:${ONBOARDING_DB_PASSWORD}@localhost:${ONBOARDING_DB_PORT}/${ONBOARDING_DB_NAME}

EOF
