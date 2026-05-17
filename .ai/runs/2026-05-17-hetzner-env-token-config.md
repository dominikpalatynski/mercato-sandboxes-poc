# Run: hetzner-env-token-config

Date: 2026-05-17
Branch: k8s-workspaces-poc
Start commit: ddcdf8b
Request: Przerobic Hetzner OpenTofu config tak, zeby sekret API byl przekazywany przez export w terminalu, a wersjonowany config pozostal w repo

## Assumptions

- The Hetzner provider should read credentials from the shell environment instead of a Terraform variable stored in `tfvars`.
- `terraform.tfvars.example` should remain the committed non-secret config file for this root.
- Local per-machine overrides may still be placed in an ignored `terraform.tfvars` when needed.

## Spec Updates

- Synced `.ai/k3s-hetzner-opentofu-sandbox.md` with the environment-variable credential flow and committed non-secret config file usage.

## Tasks

- [x] Remove the Terraform variable-based Hetzner token wiring and switch the provider to `HCLOUD_TOKEN` from the environment — verify with `tofu fmt -check -recursive infra/terraform`
- [x] Remove the token from `infra/terraform/terraform.tfvars.example` and document the export-based workflow — verify with manual review
- [x] Update the repo spec/docs to match the new committed config pattern — verify with manual review

## Execution Log

### 2026-05-17 15:06 Europe/Warsaw

- Changed: `infra/terraform/main.tf`, `infra/terraform/variables.tf`, `infra/terraform/terraform.tfvars.example`, `infra/terraform/README.md`, `.ai/k3s-hetzner-opentofu-sandbox.md`, `.ai/runs/2026-05-17-hetzner-env-token-config.md`
- Ran: manual implementation update
- Result: switched the provider from `var.hcloud_token` to native `HCLOUD_TOKEN` environment loading and moved the usage/docs to `-var-file=terraform.tfvars.example`

### 2026-05-17 19:57 Europe/Warsaw

- Changed: none
- Ran: `rg -n "hcloud_token|HCLOUD_TOKEN|terraform.tfvars.example|terraform.tfvars" infra/terraform .ai/k3s-hetzner-opentofu-sandbox.md -g '!**/.terraform/**'`, `tofu fmt -recursive infra/terraform`, `tofu fmt -check -recursive infra/terraform`, `tofu -chdir=infra/terraform validate`
- Result: no stale `hcloud_token` references remain in the repo paths touched by this change; formatting passed; `tofu validate` is still blocked by the same local `hcloud` provider plugin protocol error on `OpenTofu v1.8.0`

### 2026-05-17 19:58 Europe/Warsaw

- Changed: `infra/terraform/terraform.tfvars` (local ignored file)
- Ran: redacted file inspection plus a targeted replacement of the legacy `hcloud_token = ...` line
- Result: the local ignored tfvars file now matches the `HCLOUD_TOKEN` export workflow and will not fail on an undeclared `hcloud_token` variable

## Final Status

- Completed: native Hetzner provider environment-based credential flow, committed non-secret Terraform config, and synchronized repo/spec documentation
- Not completed: live `tofu plan/apply` against a Hetzner project
- Residual risks: the local `hcloud` provider handshake issue with `OpenTofu v1.8.0` still prevents provider-backed validation in this environment
