#!/usr/bin/env bash
# stop.sh — bring everything down, preserving volumes (DB data + coder home).
set -euo pipefail
cd "$(dirname "$0")"
docker compose down
echo "[stop] services stopped (volumes preserved). Use ./reset.sh to wipe data."
