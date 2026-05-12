#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl
require_cmd python3
ensure_runtime_dir

TEMPLATE_DIR="${K8S_DIR}/coder-template"
TOKEN_FILE="${K8S_RUNTIME_DIR}/coder-admin-token"
TEMPLATE_ID_FILE="${K8S_RUNTIME_DIR}/coder-template-id"
TEMPLATE_NAME="mercato-k8s"
REMOTE_TEMPLATE_DIR="/tmp/mercato-k8s-template"

require_file "${TOKEN_FILE}"

TOKEN="$(cat "${TOKEN_FILE}")"
if [ -z "${TOKEN}" ]; then
  echo "[push-template] empty admin token; run k8s/scripts/bootstrap-coder.sh first" >&2
  exit 1
fi

POD_NAME="$(coder_pod_name)"
if [ -z "${POD_NAME}" ]; then
  echo "[push-template] could not find the Coder pod in namespace ${K8S_NAMESPACE}" >&2
  exit 1
fi

VAR_ARGS=()
add_var() {
  VAR_ARGS+=("--variable" "$1=$2")
}

[ -n "${OPENAI_API_KEY:-}" ] && add_var openai_api_key "${OPENAI_API_KEY}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && add_var anthropic_api_key "${ANTHROPIC_API_KEY}"
[ -n "${SANDBOX_DOMAIN:-}" ] && add_var sandbox_domain "${SANDBOX_DOMAIN}"
[ -n "${WILDCARD_APPS_DOMAIN:-}" ] && add_var wildcard_apps_domain "${WILDCARD_APPS_DOMAIN}"
[ -n "${PROXY_SCHEME:-}" ] && add_var proxy_scheme "${PROXY_SCHEME}"
[ -n "${CODER_PUBLIC_URL:-}" ] && add_var coder_public_url "${CODER_PUBLIC_URL}"
[ -n "${CODER_INTERNAL_URL:-}" ] && add_var agent_coder_url "${CODER_INTERNAL_URL}"
[ -n "${WORKSPACE_NAMESPACE:-}" ] && add_var workspace_namespace "${WORKSPACE_NAMESPACE}"
[ -n "${WORKSPACE_IMAGE:-}" ] && add_var workspace_image "${WORKSPACE_IMAGE}"
[ -n "${WORKSPACE_HOME_STORAGE:-}" ] && add_var home_storage_size "${WORKSPACE_HOME_STORAGE}"
[ -n "${WORKSPACE_PG_STORAGE:-}" ] && add_var pg_storage_size "${WORKSPACE_PG_STORAGE}"
[ "${WORKSPACE_NODE_OPTIONS+x}" = "x" ] && add_var workspace_node_options "${WORKSPACE_NODE_OPTIONS}"
[ "${PROXY_PORT_SUFFIX+x}" = "x" ] && add_var proxy_port_suffix "${PROXY_PORT_SUFFIX}"
[ "${WORKSPACE_STORAGE_CLASS+x}" = "x" ] && add_var workspace_storage_class "${WORKSPACE_STORAGE_CLASS}"

VERSION_NAME="v-$(date +%s)"

kubectl exec -n "${K8S_NAMESPACE}" "${POD_NAME}" -- rm -rf "${REMOTE_TEMPLATE_DIR}"
kubectl exec -n "${K8S_NAMESPACE}" "${POD_NAME}" -- mkdir -p "${REMOTE_TEMPLATE_DIR}"
kubectl cp "${TEMPLATE_DIR}/." "${K8S_NAMESPACE}/${POD_NAME}:${REMOTE_TEMPLATE_DIR}/"

attempt=1
max_attempts=3
while :; do
  if kubectl exec -n "${K8S_NAMESPACE}" "${POD_NAME}" -- \
    env CODER_URL=http://127.0.0.1:8080 CODER_SESSION_TOKEN="${TOKEN}" \
    coder templates push "${TEMPLATE_NAME}" \
      --directory "${REMOTE_TEMPLATE_DIR}" \
      --name "${VERSION_NAME}" \
      --yes \
      "${VAR_ARGS[@]}"; then
    break
  fi

  if [ "${attempt}" -ge "${max_attempts}" ]; then
    echo "[push-template] coder templates push failed after ${max_attempts} attempts" >&2
    exit 1
  fi

  sleep $(( attempt * 10 ))
  attempt=$(( attempt + 1 ))
  VERSION_NAME="v-$(date +%s)"
done

TEMPLATE_ID="$(
  kubectl exec -n "${K8S_NAMESPACE}" "${POD_NAME}" -- \
    env CODER_URL=http://127.0.0.1:8080 CODER_SESSION_TOKEN="${TOKEN}" \
    coder templates list --output json 2>/dev/null \
  | python3 -c '
import json, sys
name = "mercato-k8s"
for entry in json.load(sys.stdin):
    template = entry.get("Template", entry)
    if template.get("name") == name:
        print(template.get("id", ""))
        break
'
)"

if [ -z "${TEMPLATE_ID}" ]; then
  echo "[push-template] could not resolve template id for ${TEMPLATE_NAME}" >&2
  exit 1
fi

umask 077
printf '%s' "${TEMPLATE_ID}" > "${TEMPLATE_ID_FILE}"
chmod 600 "${TEMPLATE_ID_FILE}"

echo "[push-template] template ${TEMPLATE_NAME} pushed as ${VERSION_NAME}; id=${TEMPLATE_ID}"
