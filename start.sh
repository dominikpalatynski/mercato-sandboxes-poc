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

REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild-image) REBUILD=1 ;;
  esac
done

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
SANDBOX_DOMAIN=$(read_env SANDBOX_DOMAIN lvh.me)
CADDY_SCHEME=$(read_env CADDY_SCHEME http)
CADDY_PORT_SUFFIX=$(read_env CADDY_PORT_SUFFIX '')
CADDY_HTTP_PORT=$(read_env CADDY_HTTP_PORT 80)

mkdir -p .runtime

echo "[start] bringing up control-plane services (coder + postgres + caddy)…"
docker compose up -d postgres-coder postgres-onboarding coder caddy

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
MERCATO_WORKSPACE_IMAGE=$(read_env MERCATO_WORKSPACE_IMAGE mercato-workspace:latest)
if ! docker image inspect "$MERCATO_WORKSPACE_IMAGE" >/dev/null 2>&1; then
  REBUILD=1
fi
if [ "$REBUILD" = "1" ]; then
  bash scripts/build-workspace-image.sh
else
  echo "[start] workspace image $MERCATO_WORKSPACE_IMAGE present (use --rebuild-image to force)"
fi

# --- 4. push Coder template (task #3) ---------------------------------------
if [ -f scripts/push-template.sh ]; then
  bash scripts/push-template.sh
else
  echo "[skip] scripts/push-template.sh not yet implemented (task #3)"
fi

# --- 5. onboarding DB migrations (task #5) ----------------------------------
bash scripts/migrate-onboarding.sh

# --- 6. onboarding app start (task #5) --------------------------------------
echo "[start] building + starting onboarding container…"
docker compose up -d --build onboarding

echo "[start] waiting for onboarding on http://localhost:${ONBOARDING_HTTP_PORT}/login (timeout: 60s)…"
deadline=$(( $(date +%s) + 60 ))
while :; do
  if curl -fsS -o /dev/null "http://localhost:${ONBOARDING_HTTP_PORT}/login"; then
    echo "[start] onboarding is up."
    break
  fi
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "[start] ERROR: onboarding did not become ready in time" >&2
    docker compose logs --tail=80 onboarding || true
    exit 1
  fi
  sleep 2
done

# --- 7. print URLs ----------------------------------------------------------
cat <<EOF

[start] up.

  Coder admin:  http://localhost:${CODER_HTTP_PORT}
                (admin: ${CODER_FIRST_USER_EMAIL} / ${CODER_FIRST_USER_PASSWORD})
  Onboarding:   http://localhost:${ONBOARDING_HTTP_PORT}
  Caddy proxy:  ${CADDY_SCHEME}://<workspace>.${SANDBOX_DOMAIN}${CADDY_PORT_SUFFIX} (app)
                ${CADDY_SCHEME}://<workspace>-splash.${SANDBOX_DOMAIN}${CADDY_PORT_SUFFIX} (splash)
                listening on host port ${CADDY_HTTP_PORT}

  Onboarding DB: postgres://${ONBOARDING_DB_USER}:${ONBOARDING_DB_PASSWORD}@localhost:${ONBOARDING_DB_PORT}/${ONBOARDING_DB_NAME}

EOF
