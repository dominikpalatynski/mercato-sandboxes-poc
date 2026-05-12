#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl

SCHEMA_FILE="${ROOT_DIR}/apps/onboarding/db/schema.sql"

debug_onboarding_failure() {
  echo "[deploy-onboarding] onboarding rollout failed; dumping debug info" >&2
  echo "[deploy-onboarding] if the pod is in ImagePullBackOff or ErrImagePull, run: bash k8s/scripts/import-images.sh" >&2
  echo >&2
  kubectl -n "${K8S_NAMESPACE}" get deployment onboarding -o wide >&2 || true
  echo '---' >&2
  kubectl -n "${K8S_NAMESPACE}" get pods -l app=onboarding -o wide >&2 || true
  echo '---' >&2
  kubectl -n "${K8S_NAMESPACE}" describe deployment onboarding >&2 || true
  echo '---' >&2
  kubectl -n "${K8S_NAMESPACE}" describe pod -l app=onboarding >&2 || true
  echo '---' >&2
  kubectl -n "${K8S_NAMESPACE}" logs deploy/onboarding --all-containers=true --tail=200 >&2 || true
}

schema_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  echo "[deploy-onboarding] missing shasum/sha256sum for schema hashing" >&2
  exit 1
}

kubectl apply -f "${K8S_DIR}/manifests/local/namespace.yaml"
require_file "${SCHEMA_FILE}"

if ! kubectl -n "${K8S_NAMESPACE}" get secret "${INGRESS_TLS_SECRET_NAME}" >/dev/null 2>&1; then
  echo "[deploy-onboarding] missing TLS secret ${INGRESS_TLS_SECRET_NAME}; run k8s/scripts/create-local-tls-secret.sh first" >&2
  exit 1
fi

kubectl -n "${K8S_NAMESPACE}" create secret generic onboarding-config \
  --from-literal=jwt-secret="${ONBOARDING_JWT_SECRET}" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

if ! kubectl -n "${K8S_NAMESPACE}" get secret onboarding-coder-secrets >/dev/null 2>&1; then
  kubectl apply -f "${K8S_DIR}/manifests/local/onboarding-secrets.template.yaml"
fi

kubectl -n "${K8S_NAMESPACE}" create configmap onboarding-schema \
  --from-file=schema.sql="${SCHEMA_FILE}" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

kubectl apply -f "${K8S_DIR}/manifests/local/onboarding-service.yaml"
kubectl apply -f "${K8S_DIR}/manifests/local/onboarding-deployment.yaml"
kubectl -n "${K8S_NAMESPACE}" set image deployment/onboarding onboarding="${ONBOARDING_IMAGE}"
kubectl -n "${K8S_NAMESPACE}" patch deployment onboarding --type merge -p "$(
  printf '{"spec":{"template":{"metadata":{"annotations":{"mercato.openmercato.dev/onboarding-schema-sha":"%s"}}}}}' "$(schema_sha256 "${SCHEMA_FILE}")"
)"
kubectl apply -f "${K8S_DIR}/manifests/local/ingress.yaml"

if ! wait_for_deployment onboarding "${K8S_NAMESPACE}" 300s; then
  debug_onboarding_failure
  exit 1
fi

echo "[deploy-onboarding] onboarding and ingress are ready"
