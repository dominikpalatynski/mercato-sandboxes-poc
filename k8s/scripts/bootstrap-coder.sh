#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd curl
require_cmd jq
ensure_runtime_dir

CURL_TLS_ARGS=()
if [ "${CODER_SKIP_TLS_VERIFY}" = "true" ]; then
  CURL_TLS_ARGS=(-k)
fi

TOKEN_FILE="${K8S_RUNTIME_DIR}/coder-admin-token"
TOKEN_NAME="onboarding-app-k8s"
TOKEN_LIFETIME_LABEL="8760h"
TOKEN_LIFETIME_NS=31536000000000000

echo "[bootstrap-coder] waiting for ${CODER_ACCESS_URL}/healthz (up to 120s)"
deadline=$(( $(date +%s) + 120 ))
while :; do
  if curl "${CURL_TLS_ARGS[@]}" -fsSL -o /dev/null "${CODER_ACCESS_URL}/healthz"; then
    break
  fi
  if [ "$(date +%s)" -gt "${deadline}" ]; then
    echo "[bootstrap-coder] timed out waiting for ${CODER_ACCESS_URL}/healthz" >&2
    exit 1
  fi
  sleep 2
done

if [ -f "${TOKEN_FILE}" ]; then
  existing_token="$(cat "${TOKEN_FILE}")"
  if [ -n "${existing_token}" ]; then
    code="$(
      curl "${CURL_TLS_ARGS[@]}" -sL -o /dev/null -w '%{http_code}' \
        -H "Coder-Session-Token: ${existing_token}" \
        "${CODER_ACCESS_URL}/api/v2/users/me" || echo "000"
    )"
    if [ "${code}" = "200" ]; then
      echo "[bootstrap-coder] existing admin token is still valid"
      exit 0
    fi
  fi
fi

first_code="$(curl "${CURL_TLS_ARGS[@]}" -sL -o /dev/null -w '%{http_code}' "${CODER_ACCESS_URL}/api/v2/users/first" || echo "000")"
if [ "${first_code}" = "404" ]; then
  create_body="$(
    jq -n \
      --arg email "${CODER_FIRST_USER_EMAIL}" \
      --arg username "${CODER_FIRST_USER_USERNAME}" \
      --arg name "${CODER_FIRST_USER_USERNAME}" \
      --arg password "${CODER_FIRST_USER_PASSWORD}" \
      '{email:$email, username:$username, name:$name, password:$password, trial:false}'
  )"
  create_resp="$(
    curl "${CURL_TLS_ARGS[@]}" -sSL -X POST \
      -H "Content-Type: application/json" \
      -d "${create_body}" \
      "${CODER_ACCESS_URL}/api/v2/users/first"
  )"
  if ! echo "${create_resp}" | jq -e '.user_id // .id // .ID' >/dev/null 2>&1; then
    echo "[bootstrap-coder] failed to create first user" >&2
    echo "${create_resp}" >&2
    exit 1
  fi
elif [ "${first_code}" != "200" ]; then
  echo "[bootstrap-coder] unexpected HTTP ${first_code} from /users/first" >&2
  exit 1
fi

login_body="$(
  jq -n \
    --arg email "${CODER_FIRST_USER_EMAIL}" \
    --arg password "${CODER_FIRST_USER_PASSWORD}" \
    '{email:$email, password:$password}'
)"
login_resp="$(
  curl "${CURL_TLS_ARGS[@]}" -sSL -X POST \
    -H "Content-Type: application/json" \
    -d "${login_body}" \
    "${CODER_ACCESS_URL}/api/v2/users/login"
)"
session_token="$(echo "${login_resp}" | jq -r '.session_token // empty')"
if [ -z "${session_token}" ]; then
  echo "[bootstrap-coder] login failed" >&2
  echo "${login_resp}" >&2
  exit 1
fi

token_body="$(
  jq -n \
    --arg name "${TOKEN_NAME}" \
    --argjson lifetime "${TOKEN_LIFETIME_NS}" \
    '{token_name:$name, scope:"all", lifetime:$lifetime}'
)"
token_resp="$(
  curl "${CURL_TLS_ARGS[@]}" -sSL -X POST \
    -H "Content-Type: application/json" \
    -H "Coder-Session-Token: ${session_token}" \
    -d "${token_body}" \
    "${CODER_ACCESS_URL}/api/v2/users/me/keys/tokens"
)"
api_key="$(echo "${token_resp}" | jq -r '.key // empty')"
if [ -z "${api_key}" ]; then
  echo "[bootstrap-coder] failed to mint API token" >&2
  echo "${token_resp}" >&2
  exit 1
fi

verify_code="$(
  curl "${CURL_TLS_ARGS[@]}" -sL -o /dev/null -w '%{http_code}' \
    -H "Coder-Session-Token: ${api_key}" \
    "${CODER_ACCESS_URL}/api/v2/users/me" || echo "000"
)"
if [ "${verify_code}" != "200" ]; then
  echo "[bootstrap-coder] new API token failed validation (HTTP ${verify_code})" >&2
  exit 1
fi

umask 077
printf '%s' "${api_key}" > "${TOKEN_FILE}"
chmod 600 "${TOKEN_FILE}"

echo "[bootstrap-coder] admin token written to ${TOKEN_FILE} (lifetime ${TOKEN_LIFETIME_LABEL})"
