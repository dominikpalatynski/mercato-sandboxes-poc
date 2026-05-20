# Run: onboarding-runtime-coder-public-url

Date: 2026-05-20
Branch: k8s-workspaces-poc
Start commit: f482e90
Request: Usunac env-specific build dla onboardingu i przepiac CODER_PUBLIC_URL na runtime

## Assumptions

- `CODER_PUBLIC_URL` pozostaje wymaganym runtime env dla deployu onboarding.
- Link do dashboardu Codera na stronie sandboxa moze byc bezpiecznie przekazany do client component jako zwykly prop z server componentu.
- Publiczny onboarding image powinien byc `build once, deploy anywhere`.

## Spec Updates

- No product spec changes were required.
- Updated `infra/IMAGES.md` to reflect that onboarding no longer needs a build-time `CODER_PUBLIC_URL`.

## Tasks

- [x] Remove build-time `NEXT_PUBLIC_CODER_URL` injection from onboarding — verify with `npm test`
- [x] Pass `CODER_PUBLIC_URL` to the sandbox status UI at runtime from a server component — verify with `npm test`
- [x] Simplify the GHCR onboarding build helper so it no longer requires `CODER_PUBLIC_URL` at build time — verify with `bash -n scripts/build-and-push-onboarding-image.sh`
- [x] Run a production build of onboarding to confirm the runtime wiring compiles — verify with `npm run build`

## Execution Log

### 2026-05-20 18:02 Europe/Warsaw

- Changed: none yet
- Ran: `sed -n '1,220p' apps/onboarding/package.json`, `sed -n '1,220p' apps/onboarding/next.config.js`, `sed -n '1,220p' apps/onboarding/Dockerfile`, `sed -n '1,220p' .ai/runs/2026-05-20-ghcr-image-workflow.md`, `rg -n "NEXT_PUBLIC_CODER_URL|CODER_PUBLIC_URL" apps/onboarding infra scripts -S`, `sed -n '1,320p' 'apps/onboarding/app/sandboxes/[id]/status-poller.tsx'`, `sed -n '1,260p' 'apps/onboarding/app/sandboxes/[id]/page.tsx'`, `sed -n '1,240p' apps/onboarding/lib/coder.ts`
- Result: confirmed the only client-side build-time dependency was the sandbox status page's dashboard link

### 2026-05-20 18:08 Europe/Warsaw

- Changed: `apps/onboarding/next.config.js`, `apps/onboarding/Dockerfile`, `apps/onboarding/app/sandboxes/[id]/status-poller.tsx`, `apps/onboarding/app/sandboxes/[id]/page.tsx`, `scripts/build-and-push-onboarding-image.sh`, `infra/IMAGES.md`, `infra/helm/README.md`, `infra/helm/values/onboarding.yaml`
- Ran: `bash -n scripts/build-and-push-onboarding-image.sh`, `npm test`
- Result: the onboarding build arg dependency was removed, the runtime prop wiring was added, the helper script still parses, and all 16 onboarding tests passed

### 2026-05-20 18:10 Europe/Warsaw

- Changed: none
- Ran: `npm run build`
- Result: blocked in the sandbox by `next/font` fetching `fonts.googleapis.com`; re-ran the build with escalated network access for final verification

### 2026-05-20 18:12 Europe/Warsaw

- Changed: none
- Ran: `npm run build` with network access
- Result: build passed; Next.js compiled, type-checked, generated static pages, and collected build traces successfully

## Final Status

- Completed: onboarding no longer bakes `CODER_PUBLIC_URL` into the image, the sandbox page now receives the public Coder URL at runtime, and the GHCR onboarding build helper no longer requires build-time environment overrides
- Not completed: none
- Residual risks: `CODER_PUBLIC_URL` remains a required runtime env in the deployment, but no longer forces per-environment image builds
