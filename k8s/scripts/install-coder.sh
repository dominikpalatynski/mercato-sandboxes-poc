#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl
require_cmd helm

kubectl apply -f "${K8S_DIR}/manifests/local/namespace.yaml"
kubectl -n "${K8S_NAMESPACE}" create secret generic coder-db-url \
  --from-literal=url="${CODER_DB_URL}" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

helm repo add "${CODER_HELM_REPO_NAME}" "${CODER_HELM_REPO_URL}" >/dev/null 2>&1 || true
helm repo update >/dev/null

HELM_ARGS=(
  upgrade
  --install
  coder
  "${CODER_HELM_REPO_NAME}/${CODER_HELM_CHART}"
  --namespace "${K8S_NAMESPACE}"
  --create-namespace
  --values "${K8S_DIR}/helm/coder.local.values.yaml"
  --set-string "coder.env[1].value=${CODER_ACCESS_URL}"
  --set-string "coder.env[2].value=${CODER_WILDCARD_ACCESS_URL}"
)

if [ -n "${WORKSPACE_NAMESPACE}" ] && [ "${WORKSPACE_NAMESPACE}" != "${K8S_NAMESPACE}" ]; then
  HELM_ARGS+=(
    --set-string "coder.serviceAccount.workspaceNamespaces[0].name=${WORKSPACE_NAMESPACE}"
  )
fi

if [ -n "${CODER_HELM_CHART_VERSION}" ]; then
  HELM_ARGS+=(--version "${CODER_HELM_CHART_VERSION}")
fi

helm "${HELM_ARGS[@]}" --wait

wait_for_deployment coder "${K8S_NAMESPACE}" 300s

echo "[install-coder] coder is ready in namespace ${K8S_NAMESPACE}"
