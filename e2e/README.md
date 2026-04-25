# Mercato Sandboxes — Playwright e2e

End-to-end happy-path test for the onboarding flow (sign up, create sandbox,
wait for it to become ready, admin-side API check, cleanup).

## Prereqs

The full stack must already be running:

```sh
./start.sh
```

This brings up Postgres, Coder (`:7080`), and the onboarding app (`:3000`),
and writes `.runtime/coder-admin-token` (used by the admin-API check).

## Run

```sh
cd e2e
npm install
npx playwright install chromium
npx playwright test
```

Or from the repo root:

```sh
make test
```

The first run downloads Playwright + a Chromium build (~150 MB). Subsequent
runs reuse the cache.

## Notes

- One worker, serial execution: only one workspace at a time fits within the
  POC's disk budget (see `SPEC.md` §8).
- Per-test timeout is 10 minutes — workspace provisioning on a cold cache
  (npx create-mercato-app + yarn install) can take several minutes.
- On failure, see `playwright-report/index.html` for traces, screenshots, and
  video.
- The cleanup hook deletes the e2e workspace via the onboarding DELETE API.
  Verify with:

  ```sh
  TOKEN=$(cat .runtime/coder-admin-token)
  curl -s -H "Coder-Session-Token: $TOKEN" \
    http://localhost:7080/api/v2/workspaces \
    | jq '.workspaces[] | select(.name | startswith("e2e-"))'
  ```
