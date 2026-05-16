#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd npm

APP_DIR="${ROOT_DIR}/apps/onboarding"
TOKEN_FILE="${K8S_RUNTIME_DIR}/coder-admin-token"
TEMPLATE_ID_FILE="${K8S_RUNTIME_DIR}/coder-template-id"

require_file "${TOKEN_FILE}"
require_file "${TEMPLATE_ID_FILE}"

if [ ! -d "${APP_DIR}/node_modules" ]; then
  cat >&2 <<EOF
[run-onboarding-local] missing ${APP_DIR}/node_modules
[run-onboarding-local] run:
  cd apps/onboarding && npm ci
EOF
  exit 1
fi

cd "${APP_DIR}"

export NODE_ENV=development
export POSTGRES_URL="postgres://onboarding:onboarding@127.0.0.1:${LOCAL_ONBOARDING_DB_PORT}/onboarding"
export JWT_SECRET="${ONBOARDING_JWT_SECRET}"
export CODER_URL="http://127.0.0.1:${LOCAL_CODER_API_PORT}"
export CODER_PUBLIC_URL="${CODER_PUBLIC_URL}"
export WILDCARD_APPS_DOMAIN="${WILDCARD_APPS_DOMAIN}"
export CODER_ADMIN_TOKEN_FILE="${TOKEN_FILE}"
export CODER_TEMPLATE_ID_FILE="${TEMPLATE_ID_FILE}"
export COOKIE_DOMAIN=".${SANDBOX_DOMAIN}"
export COOKIE_SECURE=false

echo "[run-onboarding-local] migrating onboarding schema on ${POSTGRES_URL}"
npm run migrate

cat <<EOF
[run-onboarding-local] starting onboarding on http://${SANDBOX_DOMAIN}:${LOCAL_ONBOARDING_APP_PORT}
[run-onboarding-local] CODER_URL=${CODER_URL}
[run-onboarding-local] CODER_PUBLIC_URL=${CODER_PUBLIC_URL}
EOF

exec npm run dev -- --hostname 0.0.0.0 --port "${LOCAL_ONBOARDING_APP_PORT}"
