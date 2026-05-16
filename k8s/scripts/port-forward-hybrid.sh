#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl

pids=()

require_service() {
  local namespace="$1"
  local name="$2"
  if ! kubectl -n "${namespace}" get service "${name}" >/dev/null 2>&1; then
    echo "[port-forward-hybrid] missing service ${namespace}/${name}" >&2
    exit 1
  fi
}

start_forward() {
  local label="$1"
  local namespace="$2"
  local resource="$3"
  shift 3

  echo "[port-forward-hybrid] ${label}: ${resource} -> $*"
  kubectl -n "${namespace}" port-forward "${resource}" "$@" &
  pids+=("$!")
}

cleanup() {
  local exit_code="$?"
  if [ "${#pids[@]}" -gt 0 ]; then
    kill "${pids[@]}" >/dev/null 2>&1 || true
    wait "${pids[@]}" >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

require_service "${INGRESS_NGINX_NAMESPACE}" "${INGRESS_CONTROLLER_SERVICE}"
require_service "${K8S_NAMESPACE}" "coder"
require_service "${K8S_NAMESPACE}" "postgres-onboarding"
require_service "${K8S_NAMESPACE}" "postgres-coder"

start_forward "ingress" "${INGRESS_NGINX_NAMESPACE}" "service/${INGRESS_CONTROLLER_SERVICE}" \
  "${PORT_FORWARD_HTTPS_PORT}:443" \
  "${PORT_FORWARD_HTTP_PORT}:80"
start_forward "coder api" "${K8S_NAMESPACE}" "service/coder" \
  "${LOCAL_CODER_API_PORT}:80"
start_forward "onboarding postgres" "${K8S_NAMESPACE}" "service/postgres-onboarding" \
  "${LOCAL_ONBOARDING_DB_PORT}:5432"
start_forward "coder postgres" "${K8S_NAMESPACE}" "service/postgres-coder" \
  "${LOCAL_CODER_DB_PORT}:5432"

cat <<EOF
[port-forward-hybrid] forwards are live until you stop this process.

Public URLs:
  - coder: ${PROXY_SCHEME}://coder.${SANDBOX_DOMAIN}${PROXY_PORT_SUFFIX}
  - workspace apps: ${PROXY_SCHEME}://3000--main--<workspace>--<user>.${WILDCARD_APPS_DOMAIN}${PROXY_PORT_SUFFIX}

Local helper endpoints:
  - coder api: http://127.0.0.1:${LOCAL_CODER_API_PORT}
  - onboarding postgres: postgres://onboarding:onboarding@127.0.0.1:${LOCAL_ONBOARDING_DB_PORT}/onboarding
  - coder postgres: postgres://coder:coder@127.0.0.1:${LOCAL_CODER_DB_PORT}/coder

EOF

wait
