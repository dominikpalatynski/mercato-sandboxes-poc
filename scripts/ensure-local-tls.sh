#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${ROOT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

: "${SANDBOX_DOMAIN:=sandbox.lvh.me}"
: "${WILDCARD_APPS_DOMAIN:=apps.sandbox.lvh.me}"
: "${TLS_CERT_FILE:=.runtime/tls/sandbox-lvh-me.crt}"
: "${TLS_KEY_FILE:=.runtime/tls/sandbox-lvh-me.key}"

case "${TLS_CERT_FILE}" in
  /*) ;;
  *) TLS_CERT_FILE="${ROOT_DIR}/${TLS_CERT_FILE#./}" ;;
esac

case "${TLS_KEY_FILE}" in
  /*) ;;
  *) TLS_KEY_FILE="${ROOT_DIR}/${TLS_KEY_FILE#./}" ;;
esac

if [ -f "${TLS_CERT_FILE}" ] && [ -f "${TLS_KEY_FILE}" ]; then
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[local-tls] missing required command: openssl" >&2
  exit 1
fi

mkdir -p "$(dirname "${TLS_CERT_FILE}")" "$(dirname "${TLS_KEY_FILE}")"

echo "[local-tls] generating local TLS certificate for ${SANDBOX_DOMAIN}..."
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "${TLS_KEY_FILE}" \
  -out "${TLS_CERT_FILE}" \
  -subj "/CN=${SANDBOX_DOMAIN}" \
  -addext "subjectAltName=DNS:${SANDBOX_DOMAIN},DNS:*.${SANDBOX_DOMAIN},DNS:${WILDCARD_APPS_DOMAIN},DNS:*.${WILDCARD_APPS_DOMAIN}" \
  >/dev/null 2>&1
