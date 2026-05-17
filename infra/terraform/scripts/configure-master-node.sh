#!/usr/bin/env bash

set -euo pipefail

MASTER_NAME="${1:-${MASTER_NAME:-master-01}}"
TAINT_CONTROL_PLANE="${TAINT_CONTROL_PLANE:-false}"
TAINT_SYSTEM="${TAINT_SYSTEM:-false}"

kubectl label node "${MASTER_NAME}" node-type=system --overwrite
kubectl label node "${MASTER_NAME}" workload-type=system --overwrite
kubectl label node "${MASTER_NAME}" node-pool=system --overwrite
kubectl label node "${MASTER_NAME}" system=true --overwrite

if [[ "${TAINT_CONTROL_PLANE}" == "true" ]]; then
  kubectl taint nodes "${MASTER_NAME}" node-role.kubernetes.io/control-plane=true:NoSchedule --overwrite
fi

if [[ "${TAINT_SYSTEM}" == "true" ]]; then
  kubectl taint nodes "${MASTER_NAME}" dedicated=system:NoSchedule --overwrite
fi

kubectl get nodes -L node-type,workload-type,node-pool,system
