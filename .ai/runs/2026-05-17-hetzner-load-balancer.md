# Run: hetzner-load-balancer

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: ddcdf8b
Request: Utworzyc `infra/terraform/load_balancer.tf` i podlaczyc load balancer do istniejacych nodow na podstawie `.ai/hetzner-k3s-loadbalancer-terraform.md`

## Assumptions

- Existing Hetzner network, subnet, control-plane server, and `sandbox_workers` resources stay in place and the load balancer should be added additively.
- "Istniejace nody" means the current sandbox worker nodes managed by `hcloud_server.sandbox_workers`; the spec marks master targeting as optional, so it remains excluded.
- The load balancer should terminate nothing and forward `80` and `443` as raw TCP to the worker nodes over the private Hetzner network.
- Porty `80` i `443` na node'ach powinny byc ograniczone do `var.network_ip_range`, zeby ruch publiczny szedl przez Load Balancer zamiast bezposrednio na publiczne IP workerow.

## Spec Updates

- No spec text changes were required; `.ai/hetzner-k3s-loadbalancer-terraform.md` was used as the implementation source.

## Tasks

- [x] Add `infra/terraform/load_balancer.tf` with the Hetzner load balancer, private network attachment, worker targets, and TCP services — verify with `tofu fmt -check -recursive infra/terraform`
- [x] Add load balancer variables and outputs to the OpenTofu root — verify with `tofu fmt -check -recursive infra/terraform`
- [x] Restrict worker HTTP/HTTPS ingress to the private Hetzner network so app traffic flows through the load balancer — verify with manual review of `infra/terraform/main.tf`
- [x] Sync `infra/terraform` docs/examples with the new load balancer inputs and outputs — verify with manual review

## Execution Log

### 2026-05-17 14:52 Europe/Warsaw

- Changed: none yet
- Ran: `sed -n '1,260p' .ai/hetzner-k3s-loadbalancer-terraform.md`, `sed -n '1,260p' infra/terraform/main.tf`, `sed -n '1,260p' infra/terraform/variables.tf`, `sed -n '1,260p' infra/terraform/outputs.tf`, `sed -n '1,260p' infra/terraform/README.md`, `sed -n '1,260p' infra/terraform/terraform.tfvars.example`
- Result: reviewed the load balancer requirements and confirmed the current root already manages the private network plus sandbox workers through `for_each`

### 2026-05-17 14:55 Europe/Warsaw

- Changed: none
- Ran: `tofu -chdir=infra/terraform providers schema -json`
- Result: blocked by the same local `OpenTofu v1.8.0` and `hcloud` provider plugin protocol issue already observed in the existing Terraform run; used the provider documentation-backed resource shape instead

### 2026-05-17 14:57 Europe/Warsaw

- Changed: `infra/terraform/load_balancer.tf`, `infra/terraform/main.tf`, `infra/terraform/variables.tf`, `infra/terraform/outputs.tf`, `infra/terraform/terraform.tfvars.example`, `infra/terraform/README.md`, `.ai/runs/2026-05-17-hetzner-load-balancer.md`
- Ran: `tofu fmt -recursive infra/terraform`, `tofu fmt -check -recursive infra/terraform`, `tofu -chdir=infra/terraform validate`, `git diff -- infra/terraform/load_balancer.tf infra/terraform/main.tf infra/terraform/variables.tf infra/terraform/outputs.tf infra/terraform/terraform.tfvars.example infra/terraform/README.md .ai/runs/2026-05-17-hetzner-load-balancer.md`
- Result: formatting passed for the Terraform root; `tofu validate` is still blocked by the same local `hcloud` provider plugin protocol error on `OpenTofu v1.8.0`

## Final Status

- Completed: additive load balancer configuration in `infra/terraform`, worker target attachment for all current sandbox workers, private-network-only node ingress for `80/443`, new load balancer variables and outputs, and README/tfvars example synchronization
- Not completed: live `tofu plan/apply` against a Hetzner project and post-apply DNS wildcard wiring
- Residual risks: local `tofu validate`/provider schema inspection remains blocked by the previously observed `hcloud` plugin handshake issue on `OpenTofu v1.8.0`, so the change was verified with formatting and static review rather than provider-backed validation
