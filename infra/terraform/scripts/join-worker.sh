#!/usr/bin/env bash

set -euo pipefail

MASTER_PRIVATE_IP="${1:-${MASTER_PRIVATE_IP:-}}"
K3S_TOKEN_VALUE="${2:-${K3S_TOKEN_VALUE:-}}"
WORKER_PRIVATE_IP="${3:-${WORKER_PRIVATE_IP:-10.0.1.20}}"
WORKER_HOSTNAME="${WORKER_HOSTNAME:-worker-sandbox-01}"

if [[ -z "${MASTER_PRIVATE_IP}" || -z "${K3S_TOKEN_VALUE}" ]]; then
  echo "Usage: $0 <master-private-ip> <k3s-token> [worker-private-ip]" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl vim jq htop
sudo hostnamectl set-hostname "${WORKER_HOSTNAME}"

curl -sfL https://get.k3s.io | \
  K3S_URL="https://${MASTER_PRIVATE_IP}:6443" \
  K3S_TOKEN="${K3S_TOKEN_VALUE}" \
  INSTALL_K3S_EXEC="agent --node-ip ${WORKER_PRIVATE_IP}" \
  sh -
