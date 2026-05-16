#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd docker
require_cmd k3d

workspace_only=false

case "${1:-}" in
  "")
    ;;
  --workspace-only)
    workspace_only=true
    shift
    ;;
  *)
    echo "[import-images] unsupported argument: ${1}" >&2
    echo "usage: bash k8s/scripts/import-images.sh [--workspace-only]" >&2
    exit 1
    ;;
esac

if [ "$#" -ne 0 ]; then
  echo "[import-images] unexpected extra arguments: $*" >&2
  echo "usage: bash k8s/scripts/import-images.sh [--workspace-only]" >&2
  exit 1
fi

IMAGES=()

if [ "${workspace_only}" != "true" ]; then
  echo "[import-images] building onboarding image ${ONBOARDING_IMAGE}"
  docker build \
    --build-arg "CODER_PUBLIC_URL=${CODER_PUBLIC_URL}" \
    -t "${ONBOARDING_IMAGE}" \
    "${ROOT_DIR}/apps/onboarding"
  IMAGES+=("${ONBOARDING_IMAGE}")
fi

echo "[import-images] building workspace image ${WORKSPACE_IMAGE}"
MERCATO_WORKSPACE_IMAGE="${WORKSPACE_IMAGE}" bash "${ROOT_DIR}/scripts/build-workspace-image.sh"

# The root build helper sources the repo .env, which may pin
# MERCATO_WORKSPACE_IMAGE=mercato-workspace:latest. Keep the k8s path additive
# by retagging that local result instead of modifying the existing Docker flow.
if ! docker image inspect "${WORKSPACE_IMAGE}" >/dev/null 2>&1; then
  if docker image inspect mercato-workspace:latest >/dev/null 2>&1; then
    echo "[import-images] retagging mercato-workspace:latest -> ${WORKSPACE_IMAGE}"
    docker tag mercato-workspace:latest "${WORKSPACE_IMAGE}"
  else
    echo "[import-images] expected workspace image ${WORKSPACE_IMAGE} was not built and mercato-workspace:latest is also missing" >&2
    exit 1
  fi
fi

IMAGES+=("${WORKSPACE_IMAGE}")

echo "[import-images] importing images into k3d cluster ${K3D_CLUSTER_NAME}"
k3d image import "${IMAGES[@]}" -c "${K3D_CLUSTER_NAME}"

echo "[import-images] done"
