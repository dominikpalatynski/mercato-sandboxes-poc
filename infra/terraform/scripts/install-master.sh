#!/usr/bin/env bash

set -euo pipefail

MASTER_PRIVATE_IP="${1:-${MASTER_PRIVATE_IP:-}}"
MASTER_PUBLIC_IP="${2:-${MASTER_PUBLIC_IP:-}}"
MASTER_HOSTNAME="${MASTER_HOSTNAME:-master-01}"

if [[ -z "${MASTER_PRIVATE_IP}" || -z "${MASTER_PUBLIC_IP}" ]]; then
  echo "Usage: $0 <master-private-ip> <master-public-ip>" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl vim jq htop
sudo hostnamectl set-hostname "${MASTER_HOSTNAME}"

curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="server \
  --node-ip ${MASTER_PRIVATE_IP} \
  --advertise-address ${MASTER_PRIVATE_IP} \
  --tls-san ${MASTER_PUBLIC_IP} \
  --tls-san ${MASTER_PRIVATE_IP} \
  --write-kubeconfig-mode 644" sh -

sudo kubectl get nodes -o wide
sudo kubectl get pods -A

echo
echo "Join token:"
sudo cat /var/lib/rancher/k3s/server/node-token
