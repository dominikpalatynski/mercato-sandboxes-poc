#!/usr/bin/env bash
# bootstrap-coder.sh — idempotent Coder admin bootstrap.
#
# Per SPEC.md §5 step 2:
#   1. wait for Coder /healthz
#   2. if .runtime/coder-admin-token exists and still valid -> noop
#   3. else: create first admin (if missing), login, mint long-lived API token,
#      write to .runtime/coder-admin-token (mode 600)
#
# Reads CODER_FIRST_USER_{EMAIL,USERNAME,PASSWORD} from .env (with defaults).

set -euo pipefail

cd "$(dirname "$0")/.."

CODER_URL="${CODER_URL:-http://localhost:7080}"
RUNTIME_DIR=".runtime"
TOKEN_FILE="${RUNTIME_DIR}/coder-admin-token"
TOKEN_NAME="onboarding-app"
TOKEN_LIFETIME_LABEL="8760h"
# Coder's CreateTokenRequest.lifetime is a Go time.Duration -> JSON number of nanoseconds.
# 8760h = 365d = 31_536_000 seconds = 31_536_000_000_000_000 ns
TOKEN_LIFETIME_NS=31536000000000000

if ! command -v jq >/dev/null 2>&1; then
  echo "[bootstrap-coder] ERROR: jq is required but not installed. Install via 'brew install jq'." >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"

# 1. Wait for Coder healthz (up to 120s, poll every 2s)
echo "[bootstrap-coder] waiting for ${CODER_URL}/healthz (up to 120s)…"
deadline=$(( $(date +%s) + 120 ))
while :; do
  if curl -fsS -o /dev/null "${CODER_URL}/healthz"; then
    echo "[bootstrap-coder] coder is up."
    break
  fi
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "[bootstrap-coder] ERROR: timed out waiting for ${CODER_URL}/healthz" >&2
    exit 1
  fi
  sleep 2
done

# 2. If token already exists and is valid, exit idempotently.
if [ -f "$TOKEN_FILE" ]; then
  existing_token="$(cat "$TOKEN_FILE")"
  if [ -n "$existing_token" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Coder-Session-Token: ${existing_token}" \
      "${CODER_URL}/api/v2/users/me" || echo "000")"
    if [ "$code" = "200" ]; then
      echo "[ok] existing admin token still valid"
      exit 0
    fi
    echo "[bootstrap-coder] existing token invalid (HTTP ${code}); minting a new one."
  fi
fi

# 3. Load .env so CODER_FIRST_USER_* vars are available
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

EMAIL="${CODER_FIRST_USER_EMAIL:-admin@local.dev}"
USERNAME="${CODER_FIRST_USER_USERNAME:-admin}"
PASSWORD="${CODER_FIRST_USER_PASSWORD:-Sup3rSecret!}"

# 4. Check if first user exists; create if not.
first_code="$(curl -s -o /dev/null -w '%{http_code}' "${CODER_URL}/api/v2/users/first" || echo "000")"
if [ "$first_code" = "404" ]; then
  echo "[bootstrap-coder] no admin yet; creating first user (${EMAIL})…"
  create_body="$(jq -n \
    --arg email "$EMAIL" \
    --arg username "$USERNAME" \
    --arg name "$USERNAME" \
    --arg password "$PASSWORD" \
    '{email:$email, username:$username, name:$name, password:$password, trial:false}')"
  create_resp="$(curl -sS -X POST \
    -H "Content-Type: application/json" \
    -d "$create_body" \
    "${CODER_URL}/api/v2/users/first")"
  if ! echo "$create_resp" | jq -e '.user_id // .id // .ID' >/dev/null 2>&1; then
    echo "[bootstrap-coder] ERROR: failed to create first user. Response:" >&2
    echo "$create_resp" >&2
    exit 1
  fi
  echo "[bootstrap-coder] first user created."
elif [ "$first_code" = "200" ]; then
  echo "[bootstrap-coder] first user already exists; will log in as ${EMAIL}."
else
  echo "[bootstrap-coder] ERROR: unexpected HTTP ${first_code} from /users/first" >&2
  exit 1
fi

# 5. Login -> session_token
login_body="$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" \
  '{email:$email, password:$password}')"
login_resp="$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d "$login_body" \
  "${CODER_URL}/api/v2/users/login")"
session_token="$(echo "$login_resp" | jq -r '.session_token // empty')"
if [ -z "$session_token" ]; then
  echo "[bootstrap-coder] ERROR: login failed for ${EMAIL}. Response:" >&2
  echo "$login_resp" >&2
  exit 1
fi

# 6. Mint long-lived API token
token_body="$(jq -n \
  --arg name "$TOKEN_NAME" \
  --argjson lifetime "$TOKEN_LIFETIME_NS" \
  '{token_name:$name, scope:"all", lifetime:$lifetime}')"
token_resp="$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Coder-Session-Token: ${session_token}" \
  -d "$token_body" \
  "${CODER_URL}/api/v2/users/me/keys/tokens")"
api_key="$(echo "$token_resp" | jq -r '.key // empty')"
if [ -z "$api_key" ]; then
  echo "[bootstrap-coder] ERROR: failed to mint API token. Response:" >&2
  echo "$token_resp" >&2
  exit 1
fi

# 7. Verify the new token works
verify_code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Coder-Session-Token: ${api_key}" \
  "${CODER_URL}/api/v2/users/me" || echo "000")"
if [ "$verify_code" != "200" ]; then
  echo "[bootstrap-coder] ERROR: new API token did not validate (HTTP ${verify_code})" >&2
  exit 1
fi

# 8. Persist token (mode 600)
umask 077
printf '%s' "$api_key" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

echo "[ok] admin token written to ${TOKEN_FILE} (token_name=${TOKEN_NAME}, lifetime=${TOKEN_LIFETIME_LABEL})"
