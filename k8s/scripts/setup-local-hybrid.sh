#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

run_step() {
  local label="$1"
  shift
  echo
  echo "[setup-local-hybrid] ${label}"
  "$@"
}

run_step "creating or reusing the k3d cluster" bash "${SCRIPT_DIR}/cluster-create.sh"
run_step "building and importing the workspace image" bash "${SCRIPT_DIR}/import-images.sh" --workspace-only
run_step "deploying postgres-coder and postgres-onboarding" bash "${SCRIPT_DIR}/deploy-postgres.sh"
run_step "installing coder" bash "${SCRIPT_DIR}/install-coder.sh"
run_step "creating the local TLS secret" bash "${SCRIPT_DIR}/create-local-tls-secret.sh"
run_step "applying the coder-only ingress" kubectl apply -f "${K8S_DIR}/manifests/local/ingress-coder-only.yaml"

cat <<EOF

[setup-local-hybrid] Kubernetes control plane is ready for the hybrid flow.

Next steps:
  1. Keep these forwards running in a separate shell:
     bash k8s/scripts/port-forward-hybrid.sh

  2. Bootstrap Coder and push the Kubernetes template:
     bash k8s/scripts/bootstrap-coder.sh
     bash k8s/scripts/push-template.sh

  3. Install onboarding dependencies once, then run it locally:
     cd apps/onboarding && npm ci
     cd ../..
     bash k8s/scripts/run-onboarding-local.sh

Hybrid URLs:
  - local onboarding dev server: http://${SANDBOX_DOMAIN}:${LOCAL_ONBOARDING_APP_PORT}
  - coder: ${PROXY_SCHEME}://coder.${SANDBOX_DOMAIN}${PROXY_PORT_SUFFIX}
  - workspace apps: ${PROXY_SCHEME}://3000--main--<workspace>--<user>.${WILDCARD_APPS_DOMAIN}${PROXY_PORT_SUFFIX}

EOF
