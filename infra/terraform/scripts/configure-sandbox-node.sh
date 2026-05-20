#!/usr/bin/env bash

set -euo pipefail

WORKER_NAME="${1:-${WORKER_NAME:-worker-sandbox-01}}"
TAINT_WORKER="${TAINT_WORKER:-true}"

kubectl label node "${WORKER_NAME}" node-pool=sandbox --overwrite
kubectl label node "${WORKER_NAME}" node-type=sandbox --overwrite
kubectl label node "${WORKER_NAME}" workload-type=sandbox --overwrite

if [[ "${TAINT_WORKER}" == "true" ]]; then
  kubectl taint nodes "${WORKER_NAME}" dedicated=sandbox:NoSchedule --overwrite
fi

kubectl get nodes -L node-pool,node-type,workload-type
