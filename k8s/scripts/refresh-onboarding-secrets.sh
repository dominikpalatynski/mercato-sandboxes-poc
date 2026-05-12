#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl
ensure_runtime_dir

TOKEN_FILE="${K8S_RUNTIME_DIR}/coder-admin-token"
TEMPLATE_ID_FILE="${K8S_RUNTIME_DIR}/coder-template-id"

require_file "${TOKEN_FILE}"
require_file "${TEMPLATE_ID_FILE}"

kubectl -n "${K8S_NAMESPACE}" create secret generic onboarding-coder-secrets \
  --from-file=coder-admin-token="${TOKEN_FILE}" \
  --from-file=coder-template-id="${TEMPLATE_ID_FILE}" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

if kubectl -n "${K8S_NAMESPACE}" get deployment onboarding >/dev/null 2>&1; then
  kubectl -n "${K8S_NAMESPACE}" rollout restart deployment/onboarding
  wait_for_deployment onboarding "${K8S_NAMESPACE}" 300s
fi

echo "[refresh-onboarding-secrets] onboarding secret refreshed"
