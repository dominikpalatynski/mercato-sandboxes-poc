#!/usr/bin/env bash
# build-and-push-openmercato-image.sh - builds and pushes the production
# OpenMercato CRM image to a public registry.

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
    echo "[openmercato-image] ERROR: required command '$1' is not installed" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd git

if ! docker buildx version >/dev/null 2>&1; then
  echo "[openmercato-image] ERROR: docker buildx is required" >&2
  exit 1
fi

GHCR_OWNER="${GHCR_OWNER:-dominikpalatynski}"
IMAGE_PLATFORM="${IMAGE_PLATFORM:-linux/amd64}"
IMAGE_TAG="${IMAGE_TAG:-v1.3.0}"
OPENMERCATO_IMAGE_REPOSITORY="${OPENMERCATO_IMAGE_REPOSITORY:-ghcr.io/${GHCR_OWNER}/crm}"
OPENMERCATO_CONTEXT="${OPENMERCATO_CONTEXT:-.}"
OPENMERCATO_DOCKERFILE="${OPENMERCATO_DOCKERFILE:-Dockerfile}"
IMAGE_REF="${OPENMERCATO_IMAGE_REPOSITORY}:${IMAGE_TAG}"

echo "[openmercato-image] building ${IMAGE_REF} for ${IMAGE_PLATFORM}..."
docker buildx build \
  --platform "${IMAGE_PLATFORM}" \
  -f "${OPENMERCATO_DOCKERFILE}" \
  -t "${IMAGE_REF}" \
  --push \
  "${OPENMERCATO_CONTEXT}"

echo "[openmercato-image] pushed ${IMAGE_REF}"
echo "[openmercato-image] update infra/helm/values/openmercato.yaml:"
echo "  image.repository: ${OPENMERCATO_IMAGE_REPOSITORY}"
echo "  image.tag: ${IMAGE_TAG}"
