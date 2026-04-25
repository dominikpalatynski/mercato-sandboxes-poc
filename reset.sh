#!/usr/bin/env bash
# reset.sh — DESTRUCTIVE: bring everything down AND remove volumes.
# Wipes onboarding DB, coder DB, and coder home. Also clears .runtime/ tokens.
set -euo pipefail
cd "$(dirname "$0")"
docker compose down -v
rm -rf .runtime
echo "[reset] services stopped and volumes removed. .runtime/ cleared."
