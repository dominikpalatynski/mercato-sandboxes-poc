#!/usr/bin/env bash
# build-and-push-workspace-image.sh - builds and pushes the production Coder
# workspace image to a public registry.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[workspace-image] ERROR: required command '$1' is not installed" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd git

if ! docker buildx version >/dev/null 2>&1; then
  echo "[workspace-image] ERROR: docker buildx is required" >&2
  exit 1
fi

GHCR_OWNER="${GHCR_OWNER:-dominikpalatynski}"
IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"
IMAGE_TAG="${IMAGE_TAG:-git-$(git rev-parse --short HEAD)}"
WORKSPACE_IMAGE_REPOSITORY="${WORKSPACE_IMAGE_REPOSITORY:-ghcr.io/${GHCR_OWNER}/mercato-workspace}"
IMAGE_REF="${WORKSPACE_IMAGE_REPOSITORY}:${IMAGE_TAG}-v2"

echo "[workspace-image] building ${IMAGE_REF} for ${IMAGE_PLATFORM}..."
docker buildx build \
  --platform "${IMAGE_PLATFORM}" \
  -t "${IMAGE_REF}" \
  --push \
  ./coder/workspace-image

echo "[workspace-image] pushed ${IMAGE_REF}"
echo "[workspace-image] update infra/helm/values/coder-bootstrap.yaml:"
echo "  template.workspaceImage: ${IMAGE_REF}"
