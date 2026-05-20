#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

CONTEXT_NAME="k3d-${K3D_CLUSTER_NAME}"

require_cmd k3d
require_cmd docker
require_cmd kubectl
require_cmd helm

bash "${ROOT_DIR}/scripts/ensure-local-tls.sh"

cluster_exists() {
  k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${K3D_CLUSTER_NAME}"
}

cluster_api_ready() {
  kubectl --context "${CONTEXT_NAME}" get --raw=/readyz >/dev/null 2>&1
}

wait_for_cluster_api() {
  local attempts="${1:-30}"
  while [ "${attempts}" -gt 0 ]; do
    if cluster_api_ready; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  return 1
}

cluster_container_count() {
  docker ps -a --format '{{.Names}}' \
    | grep -Ec "^k3d-${K3D_CLUSTER_NAME}-(server|agent|lb)-" || true
}

create_cluster() {
  echo "[cluster-create] creating k3d cluster ${K3D_CLUSTER_NAME}"
  k3d cluster create "${K3D_CLUSTER_NAME}" \
    --servers "${K3D_SERVERS}" \
    --agents "${K3D_AGENTS}" \
    --k3s-node-label "node-pool=sandbox@agent:*" \
    --k3s-node-label "node-type=sandbox@agent:*" \
    --k3s-node-label "workload-type=sandbox@agent:*" \
    --wait \
    --k3s-arg "--disable=traefik@server:*"
}

if cluster_exists; then
  echo "[cluster-create] reusing existing k3d cluster ${K3D_CLUSTER_NAME}"
else
  create_cluster
fi

if ! kubectl config use-context "${CONTEXT_NAME}" >/dev/null 2>&1 || ! wait_for_cluster_api 5; then
  if cluster_exists && [ "$(cluster_container_count)" = "0" ]; then
    echo "[cluster-create] found stale k3d metadata for ${K3D_CLUSTER_NAME}; recreating cluster"
    k3d cluster delete "${K3D_CLUSTER_NAME}" >/dev/null 2>&1 || true
    create_cluster
    kubectl config use-context "${CONTEXT_NAME}" >/dev/null
  else
    cat >&2 <<EOF
[cluster-create] existing cluster context ${CONTEXT_NAME} is unreachable.
[cluster-create] If Docker was restarted or the cluster was removed manually, delete the stale cluster metadata and rerun:
  k3d cluster delete ${K3D_CLUSTER_NAME}
  bash k8s/scripts/setup-local.sh
EOF
    exit 1
  fi
fi

if ! wait_for_cluster_api; then
  echo "[cluster-create] cluster API for ${CONTEXT_NAME} did not become ready" >&2
  exit 1
fi

agent_nodes="$(kubectl get nodes -o name | awk -F/ '/k3d-.*-agent-/ {print $2}')"
if [ -n "${agent_nodes}" ]; then
  # Keep workspace workloads off the server node so Mercato's heavy local dev
  # startup does not contend with the control plane and Coder itself.
  printf '%s\n' "${agent_nodes}" | while IFS= read -r node; do
    kubectl label node "${node}" node-pool=sandbox --overwrite >/dev/null
    kubectl label node "${node}" node-type=sandbox --overwrite >/dev/null
    kubectl label node "${node}" workload-type=sandbox --overwrite >/dev/null
  done
fi

kubectl apply -f "${K8S_DIR}/manifests/local/namespace.yaml"
kubectl create namespace "${INGRESS_NGINX_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

helm repo add "${INGRESS_NGINX_HELM_REPO_NAME}" "${INGRESS_NGINX_HELM_REPO_URL}" >/dev/null 2>&1 || true
helm repo update >/dev/null

helm upgrade --install ingress-nginx \
  "${INGRESS_NGINX_HELM_REPO_NAME}/${INGRESS_NGINX_CHART}" \
  --namespace "${INGRESS_NGINX_NAMESPACE}" \
  --create-namespace \
  --set controller.service.type=ClusterIP \
  --set controller.ingressClass=nginx \
  --set controller.ingressClassResource.name=nginx \
  --set controller.allowSnippetAnnotations=true \
  --set-string controller.config.annotations-risk-level=Critical \
  --wait

echo "[cluster-create] cluster and ingress-nginx are ready"
