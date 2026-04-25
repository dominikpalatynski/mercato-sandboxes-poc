#!/usr/bin/env bash
# push-template.sh — package + upload the coder/template/ directory to Coder,
# create a new template version, poll the provisioner job, and promote the
# version to template "mercato" (creating the template on first run).
#
# Idempotent: re-running creates a new version and switches active_version_id.
#
# Per SPEC.md §5 step 4. Runs after bootstrap-coder.sh + build-workspace-image.sh.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  echo "[push-template] ERROR: jq is required (install via 'brew install jq')." >&2
  exit 1
fi

# 1. Source .env (best effort) and resolve CODER_URL.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
CODER_URL="${CODER_URL:-http://localhost:7080}"

TEMPLATE_DIR="./coder/template"
RUNTIME_DIR=".runtime"
TOKEN_FILE="${RUNTIME_DIR}/coder-admin-token"
TEMPLATE_ID_FILE="${RUNTIME_DIR}/coder-template-id"
TEMPLATE_NAME="mercato"
TEMPLATE_DISPLAY_NAME="Open Mercato Sandbox"
TEMPLATE_DESCRIPTION="Mercato dev environment"
TARBALL="/tmp/mercato-template.tar"
POLL_INTERVAL=2
POLL_TIMEOUT=300  # 5 minutes

# 2. Admin token.
if [ ! -f "$TOKEN_FILE" ]; then
  echo "[push-template] missing .runtime/coder-admin-token — run scripts/bootstrap-coder.sh first" >&2
  exit 1
fi
TOKEN="$(cat "$TOKEN_FILE")"
if [ -z "$TOKEN" ]; then
  echo "[push-template] missing .runtime/coder-admin-token — run scripts/bootstrap-coder.sh first" >&2
  exit 1
fi

AUTH_HEADER="Coder-Session-Token: ${TOKEN}"

# IMPORTANT: these helpers write the HTTP status to a temp file
# (.runtime/.last-http-code) instead of a shell var, because callers use
# command substitution ($(http_get …)) which runs in a subshell — variable
# assignments would not propagate back to the parent.
HTTP_CODE_FILE="${RUNTIME_DIR}/.last-http-code"
mkdir -p "$RUNTIME_DIR"

last_http_code() {
  cat "$HTTP_CODE_FILE" 2>/dev/null || echo "000"
}

http_get() {
  local path="$1" tmp
  tmp="$(mktemp)"
  curl -sS -o "$tmp" -w '%{http_code}' \
    -H "$AUTH_HEADER" \
    "${CODER_URL}${path}" > "$HTTP_CODE_FILE"
  cat "$tmp"
  rm -f "$tmp"
}

http_post_json() {
  local path="$1" body="$2" tmp
  tmp="$(mktemp)"
  curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${CODER_URL}${path}" > "$HTTP_CODE_FILE"
  cat "$tmp"
  rm -f "$tmp"
}

http_patch_json() {
  local path="$1" body="$2" tmp
  tmp="$(mktemp)"
  curl -sS -o "$tmp" -w '%{http_code}' \
    -X PATCH \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${CODER_URL}${path}" > "$HTTP_CODE_FILE"
  cat "$tmp"
  rm -f "$tmp"
}

require_2xx() {
  local what="$1" body="$2" code
  code="$(last_http_code)"
  if [[ "$code" != 2* ]]; then
    echo "[push-template] ERROR: ${what} failed (HTTP ${code})" >&2
    echo "$body" >&2
    exit 1
  fi
}

# 3. Package the template directory (uncompressed tar; Coder expects application/x-tar).
if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "[push-template] ERROR: template directory ${TEMPLATE_DIR} not found" >&2
  exit 1
fi
echo "[push-template] packaging ${TEMPLATE_DIR} -> ${TARBALL}…"
rm -f "$TARBALL"
tar -cf "$TARBALL" -C "$TEMPLATE_DIR" .

# 4. POST /api/v2/files
echo "[push-template] uploading template tarball…"
upload_tmp="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$upload_tmp" -w '%{http_code}' \
  -X POST \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/x-tar" \
  --data-binary "@${TARBALL}" \
  "${CODER_URL}/api/v2/files")"
upload_body="$(cat "$upload_tmp")"
rm -f "$upload_tmp"
if [[ "$HTTP_CODE" != 2* ]]; then
  echo "[push-template] ERROR: file upload failed (HTTP ${HTTP_CODE})" >&2
  echo "$upload_body" >&2
  exit 1
fi
FILE_ID="$(echo "$upload_body" | jq -r '.hash // empty')"
if [ -z "$FILE_ID" ]; then
  echo "[push-template] ERROR: no .hash in /api/v2/files response" >&2
  echo "$upload_body" >&2
  exit 1
fi
echo "[push-template] file id: ${FILE_ID}"

# 5. Resolve org id.
me_body="$(http_get "/api/v2/users/me")"
require_2xx "GET /api/v2/users/me" "$me_body"
ORG_ID="$(echo "$me_body" | jq -r '.organization_ids[0] // empty')"
if [ -z "$ORG_ID" ]; then
  echo "[push-template] ERROR: could not determine org id" >&2
  echo "$me_body" >&2
  exit 1
fi

# 6. Check for existing template (so we attach the new version to it).
existing_body="$(http_get "/api/v2/organizations/${ORG_ID}/templates/${TEMPLATE_NAME}")"
existing_code="$(last_http_code)"
EXISTING_TEMPLATE_ID=""
if [[ "$existing_code" == 2* ]]; then
  EXISTING_TEMPLATE_ID="$(echo "$existing_body" | jq -r '.id // empty')"
  echo "[push-template] template ${TEMPLATE_NAME} exists (id=${EXISTING_TEMPLATE_ID})"
elif [ "$existing_code" = "404" ]; then
  echo "[push-template] template ${TEMPLATE_NAME} not found; will create after first version succeeds"
else
  echo "[push-template] ERROR: template lookup failed (HTTP ${existing_code})" >&2
  echo "$existing_body" >&2
  exit 1
fi

# 7. Create template version.
VERSION_NAME="v-$(date +%s)"
if [ -n "$EXISTING_TEMPLATE_ID" ]; then
  tv_body_in="$(jq -n \
    --arg name "$VERSION_NAME" \
    --arg file_id "$FILE_ID" \
    --arg template_id "$EXISTING_TEMPLATE_ID" \
    '{name:$name, storage_method:"file", provisioner:"terraform", file_id:$file_id, template_id:$template_id, tags:{}}')"
else
  tv_body_in="$(jq -n \
    --arg name "$VERSION_NAME" \
    --arg file_id "$FILE_ID" \
    '{name:$name, storage_method:"file", provisioner:"terraform", file_id:$file_id, tags:{}}')"
fi

echo "[push-template] creating template version ${VERSION_NAME}…"
tv_body="$(http_post_json "/api/v2/organizations/${ORG_ID}/templateversions" "$tv_body_in")"
require_2xx "POST templateversions" "$tv_body"
TVID="$(echo "$tv_body" | jq -r '.id // empty')"
JOB_ID="$(echo "$tv_body" | jq -r '.job.id // empty')"
if [ -z "$TVID" ]; then
  echo "[push-template] ERROR: no template version id returned" >&2
  echo "$tv_body" >&2
  exit 1
fi
echo "[push-template] version id: ${TVID} (job ${JOB_ID})"

# 8. Poll job status.
echo -n "[push-template] waiting for provisioner"
deadline=$(( $(date +%s) + POLL_TIMEOUT ))
JOB_STATUS=""
while :; do
  poll_body="$(http_get "/api/v2/templateversions/${TVID}")"
  poll_code="$(last_http_code)"
  if [[ "$poll_code" != 2* ]]; then
    echo
    echo "[push-template] ERROR: poll failed (HTTP ${poll_code})" >&2
    echo "$poll_body" >&2
    exit 1
  fi
  JOB_STATUS="$(echo "$poll_body" | jq -r '.job.status // empty')"
  case "$JOB_STATUS" in
    succeeded|failed|canceled)
      break
      ;;
  esac
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo
    echo "[push-template] ERROR: timed out waiting for job (last status: ${JOB_STATUS})" >&2
    exit 1
  fi
  echo -n "."
  sleep "$POLL_INTERVAL"
done
echo " ${JOB_STATUS}"

if [ "$JOB_STATUS" != "succeeded" ]; then
  echo "[push-template] ERROR: template version job ended with status=${JOB_STATUS}" >&2
  echo "[push-template] --- build logs ---" >&2
  curl -sS -H "$AUTH_HEADER" "${CODER_URL}/api/v2/templateversions/${TVID}/logs" >&2 || true
  echo >&2
  echo "[push-template] --- end build logs ---" >&2
  exit 1
fi

# 9. Create template (if missing) or PATCH active_version_id.
if [ -z "$EXISTING_TEMPLATE_ID" ]; then
  echo "[push-template] creating template ${TEMPLATE_NAME}…"
  create_in="$(jq -n \
    --arg name "$TEMPLATE_NAME" \
    --arg display "$TEMPLATE_DISPLAY_NAME" \
    --arg desc "$TEMPLATE_DESCRIPTION" \
    --arg tvid "$TVID" \
    '{name:$name, display_name:$display, description:$desc, template_version_id:$tvid}')"
  create_body="$(http_post_json "/api/v2/organizations/${ORG_ID}/templates" "$create_in")"
  require_2xx "POST templates" "$create_body"
  TEMPLATE_ID="$(echo "$create_body" | jq -r '.id // empty')"
  if [ -z "$TEMPLATE_ID" ]; then
    echo "[push-template] ERROR: no template id in create response" >&2
    echo "$create_body" >&2
    exit 1
  fi
else
  TEMPLATE_ID="$EXISTING_TEMPLATE_ID"
  echo "[push-template] promoting version ${TVID} on template ${TEMPLATE_ID}…"
  # Coder's CLI uses PATCH /api/v2/templates/{id}/versions  body={"id":"<tvid>"}
  # to set the active version. PATCH /api/v2/templates/{id} accepts
  # active_version_id in its schema but silently ignores it on this code path.
  promote_in="$(jq -n --arg tvid "$TVID" '{id:$tvid}')"
  promote_body="$(http_patch_json "/api/v2/templates/${TEMPLATE_ID}/versions" "$promote_in")"
  require_2xx "PATCH templates/.../versions" "$promote_body"
fi

# 10. Persist template id (mode 600).
mkdir -p "$RUNTIME_DIR"
umask 077
printf '%s' "$TEMPLATE_ID" > "$TEMPLATE_ID_FILE"
chmod 600 "$TEMPLATE_ID_FILE"

echo "[ok] template mercato pushed; id=${TEMPLATE_ID}; active version ${TVID}"
