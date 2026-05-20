# Run: ghcr-image-workflow

Date: 2026-05-20
Branch: k8s-workspaces-poc
Start commit: f482e90
Request: Przygotowac prosty workflow build/push obrazow do publicznego GHCR bez automatycznej edycji chart values

## Assumptions

- Production images will stay public in GHCR under the `palatynskicloud` owner.
- Chart values should still be updated manually after each push.
- The current Hetzner worker types are x86_64, so the production build target should default to `linux/amd64`.
- The onboarding image remains environment-specific because `CODER_PUBLIC_URL` is still passed as a Docker build argument.

## Spec Updates

- No product spec changes were required.
- Added an operational convention doc in `infra/IMAGES.md`.

## Tasks

- [x] Add a production helper for building and pushing the workspace image to GHCR — verify with `bash -n scripts/build-and-push-workspace-image.sh`
- [x] Add a production helper for building and pushing the onboarding image to GHCR — verify with `bash -n scripts/build-and-push-onboarding-image.sh`
- [x] Document the GHCR naming, tagging, and manual values update flow — verify with manual review of `infra/IMAGES.md`
- [x] Link the new workflow from the Helm deployment docs and relevant values files — verify with manual review

## Execution Log

### 2026-05-20 17:44 Europe/Warsaw

- Changed: none yet
- Ran: `sed -n '1,220p' scripts/build-workspace-image.sh`, `sed -n '1,220p' infra/helm/values/coder-bootstrap.yaml`, `sed -n '1,220p' infra/helm/values/onboarding.yaml`, `sed -n '1,220p' apps/onboarding/Dockerfile`, `rg -n "ghcr|build-and-push|workspaceImage|mercato-onboarding|mercato-workspace|image build|registry" -S .`, `sed -n '1,240p' infra/helm/README.md`
- Result: confirmed the repo had placeholders for production image refs but no consistent GHCR build/push convention

### 2026-05-20 17:51 Europe/Warsaw

- Changed: `scripts/build-and-push-workspace-image.sh`, `scripts/build-and-push-onboarding-image.sh`, `infra/IMAGES.md`, `infra/helm/README.md`, `infra/helm/values/onboarding.yaml`, `infra/helm/values/coder-bootstrap.yaml`
- Ran: `chmod +x scripts/build-and-push-workspace-image.sh scripts/build-and-push-onboarding-image.sh`, `bash -n scripts/build-and-push-workspace-image.sh`, `bash -n scripts/build-and-push-onboarding-image.sh`
- Result: added the GHCR workflow scripts, documented the convention, and verified both scripts parse successfully

## Final Status

- Completed: public GHCR build/push scripts for onboarding and workspace images, immutable tag convention doc, manual follow-up guidance for Helm values, and links from deployment docs
- Not completed: live `docker buildx --push` against GHCR and a full cluster deployment using the new image refs
- Residual risks: the onboarding image still bakes `CODER_PUBLIC_URL` at build time, so each environment requires a separate build unless that behavior is refactored later
