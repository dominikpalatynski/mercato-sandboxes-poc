#!/usr/bin/env bash
# Minimal production deploy for the nginx-edge topology.
#
# Prerequisites:
#   - .env contains production SANDBOX_DOMAIN / CODER_* / COOKIE_* values
#   - .runtime/tls/sandbox-lvh-me.crt and .runtime/tls/sandbox-lvh-me.key exist
#     and cover ${SANDBOX_DOMAIN}, *.${SANDBOX_DOMAIN}, *.apps.${SANDBOX_DOMAIN}
#   - DNS points those hosts at this machine

set -euo pipefail

cd "$(dirname "$0")/.."

CERT=".runtime/tls/sandbox-lvh-me.crt"
KEY=".runtime/tls/sandbox-lvh-me.key"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "[deploy] missing TLS cert/key: ${CERT} and ${KEY}" >&2
  exit 1
fi

echo "[deploy] starting production stack without destroying volumes..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
  postgres-coder postgres-onboarding coder edge onboarding

echo "[deploy] applying onboarding migrations..."
bash scripts/migrate-onboarding.sh

echo "[deploy] pushing current Coder template..."
bash scripts/push-template.sh

echo "[deploy] done."
