import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Mercato Sandboxes onboarding e2e suite.
 *
 * Per-test timeout is generous (10 min) because provisioning a fresh Coder
 * workspace on a cold cache (npx create-mercato-app + yarn install) can take
 * several minutes. workers=1 keeps the suite serial — only one workspace at a
 * time is realistic given the disk budget called out in .ai/SPEC.md §8.
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS !== 'false',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * `production` project — points at the live Hetzner deploy. Run with:
     *
     *   SANDBOX_DOMAIN=sandbox.openmercato.com \
     *     npx playwright test --project=production
     *
     * The base URL is the onboarding origin nginx publishes
     * (`https://app.<SANDBOX_DOMAIN>` redirects to the apex). Assumes a
     * wildcard cert is already issued; the test will fail loudly on a TLS
     * error instead of silently skipping cert validation.
     */
    {
      name: 'production',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL ?? `https://app.${process.env.SANDBOX_DOMAIN ?? 'sandbox.openmercato.com'}`,
        ignoreHTTPSErrors: false,
      },
    },
  ],
});
