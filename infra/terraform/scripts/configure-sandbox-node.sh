#!/usr/bin/env bash

set -euo pipefail

WORKER_NAME="${1:-${WORKER_NAME:-worker-sandbox-01}}"
MASTER_NAME="${2:-${MASTER_NAME:-master-01}}"
TAINT_MASTER="${TAINT_MASTER:-false}"
TAINT_WORKER="${TAINT_WORKER:-true}"

kubectl label node "${WORKER_NAME}" node-type=sandbox --overwrite
kubectl label node "${WORKER_NAME}" workload-type=sandbox --overwrite
kubectl label node "${WORKER_NAME}" sandbox=true --overwrite

if [[ "${TAINT_MASTER}" == "true" ]]; then
  kubectl taint nodes "${MASTER_NAME}" node-role.kubernetes.io/control-plane=true:NoSchedule --overwrite
fi

if [[ "${TAINT_WORKER}" == "true" ]]; then
  kubectl taint nodes "${WORKER_NAME}" dedicated=sandbox:NoSchedule --overwrite
fi

kubectl get nodes -L node-type,workload-type,sandbox
