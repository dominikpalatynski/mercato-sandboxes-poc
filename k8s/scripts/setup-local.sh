#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

steps=(
  "cluster-create.sh"
  "import-images.sh"
  "deploy-postgres.sh"
  "install-coder.sh"
  "create-local-tls-secret.sh"
  "deploy-onboarding.sh"
)

run_step() {
  local script_name="$1"
  local script_path="${SCRIPT_DIR}/${script_name}"

  echo
  echo "[setup-local] running ${script_name}"
  bash "${script_path}"
}

for step in "${steps[@]}"; do
  run_step "${step}"
done

cat <<EOF

[setup-local] local Kubernetes control plane is ready.

Next steps:
  1. In a separate shell, start the ingress port-forward:
     bash k8s/scripts/port-forward.sh

  2. Then bootstrap Coder:
     bash k8s/scripts/bootstrap-coder.sh

Recommended follow-up after bootstrap:
  bash k8s/scripts/push-template.sh
  bash k8s/scripts/refresh-onboarding-secrets.sh

Local URLs after port-forward:
  ${PROXY_SCHEME}://${SANDBOX_DOMAIN}${PROXY_PORT_SUFFIX}
  ${PROXY_SCHEME}://coder.${SANDBOX_DOMAIN}${PROXY_PORT_SUFFIX}

EOF
