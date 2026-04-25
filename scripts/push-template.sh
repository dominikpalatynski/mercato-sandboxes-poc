#!/usr/bin/env bash
# push-template.sh — push (create or update) the Coder template "mercato" by
# invoking the official `coder` CLI inside the running coder container.
#
# This replaces the previous curl/API-based implementation, which would stall
# unpredictably on the file-upload + provisioner-poll loop. The CLI handles
# tarball upload, provisioner streaming, and active-version promotion itself.
#
# Idempotent: re-runs create a new version and activate it.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

TEMPLATE_DIR="./coder/template"
RUNTIME_DIR=".runtime"
TOKEN_FILE="${RUNTIME_DIR}/coder-admin-token"
TEMPLATE_ID_FILE="${RUNTIME_DIR}/coder-template-id"
TEMPLATE_NAME="mercato"
CONTAINER="${CODER_CONTAINER:-coder}"
CONTAINER_TEMPLATE_DIR="/tmp/mercato-template"

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" >/dev/null 2>&1; then
  echo "[push-template] ERROR: container '${CONTAINER}' is not running. Start the stack first." >&2
  exit 1
fi

if [ ! -f "$TOKEN_FILE" ]; then
  echo "[push-template] missing ${TOKEN_FILE} — run scripts/bootstrap-coder.sh first" >&2
  exit 1
fi
TOKEN="$(cat "$TOKEN_FILE")"
if [ -z "$TOKEN" ]; then
  echo "[push-template] empty admin token — re-run scripts/bootstrap-coder.sh" >&2
  exit 1
fi

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "[push-template] ERROR: template directory ${TEMPLATE_DIR} not found" >&2
  exit 1
fi

# Build user-variable flags. Empty values are skipped so terraform defaults win,
# except PROXY_PORT_SUFFIX which is forwarded if *set* (empty = "no suffix").
VAR_ARGS=()
add_var() {
  VAR_ARGS+=("--variable" "$1=$2")
}
[ -n "${OPENAI_API_KEY:-}" ]      && add_var openai_api_key      "$OPENAI_API_KEY"
[ -n "${ANTHROPIC_API_KEY:-}" ]   && add_var anthropic_api_key   "$ANTHROPIC_API_KEY"
[ -n "${SANDBOX_DOMAIN:-}" ]      && add_var sandbox_domain      "$SANDBOX_DOMAIN"
[ -n "${PROXY_SCHEME:-}" ]        && add_var proxy_scheme        "$PROXY_SCHEME"
[ "${PROXY_PORT_SUFFIX+x}" = "x" ] && add_var proxy_port_suffix  "${PROXY_PORT_SUFFIX}"
[ -n "${TRAEFIK_ENTRYPOINT:-}" ]  && add_var traefik_entrypoint  "$TRAEFIK_ENTRYPOINT"

VERSION_NAME="v-$(date +%s)"

echo "[push-template] copying ${TEMPLATE_DIR} into ${CONTAINER}:${CONTAINER_TEMPLATE_DIR}…"
docker exec "$CONTAINER" rm -rf "$CONTAINER_TEMPLATE_DIR"
docker exec "$CONTAINER" mkdir -p "$CONTAINER_TEMPLATE_DIR"
docker cp "$TEMPLATE_DIR/." "${CONTAINER}:${CONTAINER_TEMPLATE_DIR}/"

echo "[push-template] running 'coder templates push ${TEMPLATE_NAME}' (version ${VERSION_NAME})…"
# Retry on transient terraform-registry / github 502s during `terraform init`
# (provider download). 3 attempts with backoff.
attempt=1
max_attempts=3
while :; do
  if docker exec \
      -e CODER_URL=http://localhost \
      -e CODER_SESSION_TOKEN="$TOKEN" \
      "$CONTAINER" \
      coder templates push "$TEMPLATE_NAME" \
        --directory "$CONTAINER_TEMPLATE_DIR" \
        --name "$VERSION_NAME" \
        --yes \
        "${VAR_ARGS[@]}"; then
    break
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[push-template] ERROR: 'coder templates push' failed after ${max_attempts} attempts" >&2
    exit 1
  fi
  echo "[push-template] attempt ${attempt} failed; retrying in $((attempt * 10))s…" >&2
  sleep $(( attempt * 10 ))
  attempt=$(( attempt + 1 ))
  VERSION_NAME="v-$(date +%s)"
done

# Resolve template id for downstream scripts (onboarding worker reads this).
TEMPLATE_ID="$(
  docker exec \
    -e CODER_URL=http://localhost \
    -e CODER_SESSION_TOKEN="$TOKEN" \
    "$CONTAINER" \
    coder templates list --output json 2>/dev/null \
  | python3 -c "
import json, sys
name = '${TEMPLATE_NAME}'
for entry in json.load(sys.stdin):
    t = entry.get('Template', entry)
    if t.get('name') == name:
        print(t.get('id', ''))
        break
"
)"

if [ -z "$TEMPLATE_ID" ]; then
  echo "[push-template] WARNING: could not resolve template id from 'coder templates list'." >&2
else
  mkdir -p "$RUNTIME_DIR"
  umask 077
  printf '%s' "$TEMPLATE_ID" > "$TEMPLATE_ID_FILE"
  chmod 600 "$TEMPLATE_ID_FILE"
fi

echo "[ok] template ${TEMPLATE_NAME} pushed; version ${VERSION_NAME}; id=${TEMPLATE_ID:-unknown}"
