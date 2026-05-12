#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/_common.sh"
load_env

require_cmd kubectl

echo "[port-forward] forwarding ingress service ${INGRESS_CONTROLLER_SERVICE}"
exec kubectl -n "${INGRESS_NGINX_NAMESPACE}" port-forward \
  service/"${INGRESS_CONTROLLER_SERVICE}" \
  "${PORT_FORWARD_HTTPS_PORT}:443" \
  "${PORT_FORWARD_HTTP_PORT}:80"
