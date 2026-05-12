#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"
ROOT_ENV_FILE="${ROOT_ENV_FILE:-${ROOT_DIR}/.env}"
K8S_ENV_FILE="${K8S_ENV_FILE:-${K8S_DIR}/env/local.env}"

load_env() {
  if [ -f "${ROOT_ENV_FILE}" ]; then
    set -a
    # shellcheck disable=SC1090
    . "${ROOT_ENV_FILE}"
    set +a
  fi

  if [ -f "${K8S_ENV_FILE}" ]; then
    set -a
    # shellcheck disable=SC1090
    . "${K8S_ENV_FILE}"
    set +a
  fi

  : "${K3D_CLUSTER_NAME:=mercato-sandboxes}"
  : "${K3D_SERVERS:=1}"
  : "${K3D_AGENTS:=1}"
  : "${K8S_NAMESPACE:=mercato-sandboxes}"
  : "${WORKSPACE_NAMESPACE:=${K8S_NAMESPACE}}"
  : "${INGRESS_NGINX_NAMESPACE:=ingress-nginx}"
  : "${SANDBOX_DOMAIN:=sandbox.lvh.me}"
  : "${WILDCARD_APPS_DOMAIN:=apps.sandbox.lvh.me}"
  : "${PROXY_SCHEME:=https}"
  : "${PROXY_PORT_SUFFIX:=:8443}"
  : "${COOKIE_DOMAIN:=.${SANDBOX_DOMAIN}}"
  : "${COOKIE_SECURE:=true}"
  : "${CODER_ACCESS_URL:=https://coder.${SANDBOX_DOMAIN}${PROXY_PORT_SUFFIX}}"
  : "${CODER_PUBLIC_URL:=${CODER_ACCESS_URL}}"
  : "${CODER_INTERNAL_URL:=http://coder.${K8S_NAMESPACE}.svc.cluster.local}"
  : "${CODER_WILDCARD_ACCESS_URL:=*.${WILDCARD_APPS_DOMAIN}}"
  : "${CODER_SKIP_TLS_VERIFY:=true}"
  : "${CODER_FIRST_USER_EMAIL:=admin@local.dev}"
  : "${CODER_FIRST_USER_USERNAME:=admin}"
  : "${CODER_FIRST_USER_PASSWORD:=Sup3rSecret!}"
  : "${CODER_HELM_REPO_NAME:=coder-v2}"
  : "${CODER_HELM_REPO_URL:=https://helm.coder.com/v2}"
  : "${CODER_HELM_CHART:=coder}"
  : "${CODER_HELM_CHART_VERSION:=2.30.0}"
  : "${INGRESS_NGINX_HELM_REPO_NAME:=ingress-nginx}"
  : "${INGRESS_NGINX_HELM_REPO_URL:=https://kubernetes.github.io/ingress-nginx}"
  : "${INGRESS_NGINX_CHART:=ingress-nginx}"
  : "${INGRESS_CONTROLLER_SERVICE:=ingress-nginx-controller}"
  : "${INGRESS_TLS_SECRET_NAME:=sandbox-lvh-me-tls}"
  : "${PORT_FORWARD_HTTP_PORT:=8080}"
  : "${PORT_FORWARD_HTTPS_PORT:=8443}"
  : "${ONBOARDING_IMAGE:=mercato-onboarding:k8s-local}"
  : "${WORKSPACE_IMAGE:=mercato-workspace:k8s-local}"
  : "${ONBOARDING_JWT_SECRET:=change-me-local-jwt-secret}"
  : "${TLS_CERT_FILE:=${ROOT_DIR}/.runtime/tls/sandbox-lvh-me.crt}"
  : "${TLS_KEY_FILE:=${ROOT_DIR}/.runtime/tls/sandbox-lvh-me.key}"
  : "${K8S_RUNTIME_DIR:=${ROOT_DIR}/.runtime/k8s}"
  : "${WORKSPACE_HOME_STORAGE:=20Gi}"
  : "${WORKSPACE_PG_STORAGE:=10Gi}"
  : "${WORKSPACE_STORAGE_CLASS:=local-path}"
  : "${WORKSPACE_NODE_OPTIONS:=--max-old-space-size=6144}"
  : "${CODER_DB_URL:=postgres://coder:coder@postgres-coder:5432/coder?sslmode=disable}"

  case "${TLS_CERT_FILE}" in
    /*) ;;
    *) TLS_CERT_FILE="${ROOT_DIR}/${TLS_CERT_FILE#./}" ;;
  esac

  case "${TLS_KEY_FILE}" in
    /*) ;;
    *) TLS_KEY_FILE="${ROOT_DIR}/${TLS_KEY_FILE#./}" ;;
  esac

  case "${K8S_RUNTIME_DIR}" in
    /*) ;;
    *) K8S_RUNTIME_DIR="${ROOT_DIR}/${K8S_RUNTIME_DIR#./}" ;;
  esac
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[k8s] missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [ ! -f "$1" ]; then
    echo "[k8s] required file not found: $1" >&2
    exit 1
  fi
}

ensure_runtime_dir() {
  mkdir -p "${K8S_RUNTIME_DIR}"
}

coder_pod_name() {
  kubectl get pods -n "${K8S_NAMESPACE}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
    | awk '/^coder-/ {print; exit}'
}

wait_for_deployment() {
  local name="$1"
  local namespace="$2"
  local timeout="${3:-180s}"
  kubectl -n "${namespace}" rollout status deployment/"${name}" --timeout="${timeout}"
}
