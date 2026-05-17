# Hetzner k3s OpenTofu Bootstrap

This directory contains an additive OpenTofu root for a minimal Hetzner Cloud
k3s topology:

- one Hetzner Load Balancer exposing ports `80` and `443`
- one control-plane VPS: `master-01`
- one or more sandbox worker VPSs, defaulting to `worker-sandbox-01`
- one private Hetzner network and subnet
- one firewall scoped to SSH, the Kubernetes API, and node-to-node traffic
- one uploaded SSH public key

Terraform/OpenTofu manages only infrastructure here. k3s installation, worker
join, and node labels/taints stay outside Terraform and are handled with the
helper scripts under [`scripts/`](./scripts).

## Files

- `main.tf`: Hetzner resources
- `load_balancer.tf`: Hetzner Load Balancer, private network attachment, worker targets, and TCP listeners
- `variables.tf`: required inputs and defaults
- `outputs.tf`: IP addresses and SSH helper commands
- `terraform.tfvars.example`: versioned non-secret configuration
- `scripts/install-master.sh`: install k3s server on `master-01`
- `scripts/join-worker.sh`: join one sandbox worker to the cluster
- `scripts/configure-master-node.sh`: apply system labels and optional taints
- `scripts/configure-sandbox-node.sh`: apply sandbox labels/taints

## Usage

From the repository root:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mercato_hetzner -C "mercato-hetzner"
export HCLOUD_TOKEN="YOUR_HETZNER_CLOUD_API_TOKEN"
tofu -chdir=infra/terraform init
tofu -chdir=infra/terraform plan -var-file=terraform.tfvars.example
tofu -chdir=infra/terraform apply -var-file=terraform.tfvars.example
tofu -chdir=infra/terraform output
```

`HCLOUD_TOKEN` is read by the Hetzner provider from the shell environment, so
the committed `terraform.tfvars.example` can stay free of secrets. If you need
machine-specific overrides, create an ignored local `terraform.tfvars`.

The default SSH key configuration now assumes:

- private key: `~/.ssh/mercato_hetzner`
- public key: `~/.ssh/mercato_hetzner.pub`
- Hetzner SSH key name: `mercato-hetzner`

The default load balancer configuration assumes:

- load balancer type: `lb11`
- private IP: `10.0.1.5`
- all `sandbox_workers` are attached as private-network targets

After `apply`, you can retrieve the public load balancer IPs with:

```bash
tofu -chdir=infra/terraform output load_balancer_ipv4
tofu -chdir=infra/terraform output load_balancer_ipv6
```

To add another sandbox worker, add one more entry to `sandbox_workers` in
`infra/terraform/terraform.tfvars.example`, for example:

```hcl
sandbox_workers = {
  "worker-sandbox-01" = {
    private_ip  = "10.0.1.20"
    server_type = "cx32"
  }

  "worker-sandbox-02" = {
    private_ip  = "10.0.1.21"
    server_type = "cx32"
  }
}
```

After `apply`, use the scripts to bootstrap k3s manually:

```bash
bash infra/terraform/scripts/install-master.sh 10.0.1.10 MASTER_PUBLIC_IP
bash infra/terraform/scripts/join-worker.sh 10.0.1.10 TOKEN_FROM_MASTER 10.0.1.20
bash infra/terraform/scripts/join-worker.sh 10.0.1.10 TOKEN_FROM_MASTER 10.0.1.21
bash infra/terraform/scripts/configure-master-node.sh
bash infra/terraform/scripts/configure-sandbox-node.sh
bash infra/terraform/scripts/configure-sandbox-node.sh worker-sandbox-02
```

`configure-master-node.sh` sets:

- `node-type=system`
- `workload-type=system`
- `node-pool=system`
- `system=true`

It can also add taints when needed:

```bash
TAINT_CONTROL_PLANE=true TAINT_SYSTEM=true \
  bash infra/terraform/scripts/configure-master-node.sh
```

`configure-sandbox-node.sh` sets:

- `node-type=sandbox`
- `workload-type=sandbox`
- `sandbox=true`

The scripts intentionally keep the cluster setup explicit. That matches the MVP
scope from `.ai/k3s-hetzner-opentofu-sandbox.md`, where OpenTofu stops at the
infrastructure boundary.
