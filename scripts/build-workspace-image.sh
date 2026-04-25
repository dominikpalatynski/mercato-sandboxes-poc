#!/usr/bin/env bash
# build-workspace-image.sh - builds the mercato-workspace image used as the
# base for every Coder workspace (see .ai/SPEC.md section 3).
#
# Honors $MERCATO_WORKSPACE_IMAGE (tag) and $WORKSPACE_BUILD_PLATFORM (default
# linux/arm64 for the Apple Silicon host this POC targets - see section 7).

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

IMAGE="${MERCATO_WORKSPACE_IMAGE:-mercato-workspace:latest}"
PLATFORM="${WORKSPACE_BUILD_PLATFORM:-linux/arm64}"

echo "[build-workspace-image] building ${IMAGE} for ${PLATFORM}..."
docker build --platform "$PLATFORM" -t "$IMAGE" ./coder/workspace-image

size_bytes=$(docker image inspect "$IMAGE" --format '{{.Size}}')
size_human=$(printf '%s' "$size_bytes" | numfmt --to=iec)
echo "[build-workspace-image] done. ${IMAGE} size: ${size_human}"
