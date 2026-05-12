#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl

kubectl apply -f "${K8S_DIR}/manifests/local/namespace.yaml"
kubectl apply -f "${K8S_DIR}/manifests/local/postgres-coder.yaml"
kubectl apply -f "${K8S_DIR}/manifests/local/postgres-onboarding.yaml"

wait_for_deployment postgres-coder "${K8S_NAMESPACE}" 180s
wait_for_deployment postgres-onboarding "${K8S_NAMESPACE}" 180s

echo "[deploy-postgres] postgres-coder and postgres-onboarding are ready"
