#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl
require_file "${TLS_CERT_FILE}"
require_file "${TLS_KEY_FILE}"

kubectl apply -f "${K8S_DIR}/manifests/local/namespace.yaml"
kubectl -n "${K8S_NAMESPACE}" create secret tls "${INGRESS_TLS_SECRET_NAME}" \
  --cert="${TLS_CERT_FILE}" \
  --key="${TLS_KEY_FILE}" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

echo "[create-local-tls-secret] secret ${INGRESS_TLS_SECRET_NAME} applied in ${K8S_NAMESPACE}"
