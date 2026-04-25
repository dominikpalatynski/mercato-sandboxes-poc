import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Full happy-path onboarding flow per SPEC.md §6.
 *
 * Tests share state through module-scope variables; describe.serial guarantees
 * sequential execution. Each test gets a fresh browser context, so we capture
 * the session cookie in test 1 and reuse it for the cleanup hook.
 */

const PASSWORD = 'Sup3rSecret!';
const ONBOARDING_BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CODER_BASE = process.env.CODER_BASE_URL ?? 'http://localhost:7080';
const CODER_TOKEN_PATH = path.resolve(__dirname, '../../.runtime/coder-admin-token');
// Caddy subdomain reverse proxy (task #14): app + splash are now served from
// <workspace>.<SANDBOX_DOMAIN> and <workspace>-splash.<SANDBOX_DOMAIN> on the
// host's standard 80/443 (override with SANDBOX_DOMAIN / CADDY_SCHEME /
// CADDY_PORT_SUFFIX to match a non-default deployment).
const SANDBOX_DOMAIN = process.env.SANDBOX_DOMAIN ?? 'lvh.me';
const CADDY_SCHEME = process.env.CADDY_SCHEME ?? 'http';
const CADDY_PORT_SUFFIX = process.env.CADDY_PORT_SUFFIX ?? '';

let email = '';
let sandboxName = '';
let sandboxId = '';
let sessionCookie = '';
let coderUsername = '';

test.describe.serial('mercato sandbox onboarding', () => {
  test.beforeAll(async () => {
    const ts = Date.now();
    email = `e2e-${ts}@example.com`;
    // sandboxName must match /^[a-z0-9-]{3,32}$/.
    sandboxName = `e2e-${String(ts).slice(-10)}`;
    // Coder username derives from the local part of the email.
    coderUsername = `e2e-${ts}`;
    // eslint-disable-next-line no-console
    console.log(`[e2e] using email=${email} sandboxName=${sandboxName}`);
  });

  test('1. signup -> dashboard', async ({ page, context }) => {
    await page.goto('/signup');

    // The redesigned signup form requires first/last name + a terms checkbox
    // before the submit button is enabled.
    await page.locator('#first_name').fill('E2E');
    await page.locator('#last_name').fill('Tester');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    // shadcn Checkbox renders as a button[role=checkbox]; click it to toggle.
    await page.locator('#accept_terms').click();
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL('**/dashboard', { timeout: 30_000 });

    // Dashboard should show "Your sandboxes" heading and a "New sandbox" CTA.
    await expect(
      page.getByRole('link', { name: /new sandbox/i }).first(),
    ).toBeVisible();

    // Stash session cookie for the cleanup hook (each test gets a fresh
    // context, so we serialise the value to module scope).
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'session');
    expect(session, 'expected session cookie after signup').toBeTruthy();
    sessionCookie = session!.value;
  });

  test('2. create sandbox -> ready with 4 links', async ({ page, context }) => {
    // Re-establish authentication on this fresh context.
    await context.addCookies([
      {
        name: 'session',
        value: sessionCookie,
        url: ONBOARDING_BASE,
      },
    ]);

    await page.goto('/sandboxes/new');
    await page.locator('input[name="name"]').fill(sandboxName);
    await page.getByRole('button', { name: /create sandbox/i }).click();

    // Land on /sandboxes/<uuid>.
    await page.waitForURL(/\/sandboxes\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const url = new URL(page.url());
    sandboxId = url.pathname.split('/').pop() ?? '';
    expect(sandboxId).toMatch(/^[0-9a-f-]{36}$/);
    // eslint-disable-next-line no-console
    console.log(`[e2e] sandboxId=${sandboxId}`);

    // Wait for the four "Open ..." links to appear. The UI only renders these
    // anchors when status === 'ready'.
    const start = Date.now();
    await page.waitForSelector('a[href*="/apps/code-server"]', { timeout: 600_000 });
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    // eslint-disable-next-line no-console
    console.log(`[e2e] workspace ready after ~${elapsedSec}s`);

    // After task #14, app + splash come from caddy subdomains; code-server +
    // terminal stay on the Coder path-based proxy.
    const coderPrefix = `${CODER_BASE}/@${coderUsername}/${sandboxName}/`;
    const appPrefix = `${CADDY_SCHEME}://${sandboxName}.${SANDBOX_DOMAIN}${CADDY_PORT_SUFFIX}`;
    const splashPrefix = `${CADDY_SCHEME}://${sandboxName}-splash.${SANDBOX_DOMAIN}${CADDY_PORT_SUFFIX}`;

    const expectedLinks: ReadonlyArray<{ selector: string; prefix: string }> = [
      { selector: 'a[href*="/apps/code-server"]', prefix: coderPrefix },
      { selector: 'a[href*="/terminal"]', prefix: coderPrefix },
      { selector: `a[href^="${appPrefix}"]`, prefix: appPrefix },
      { selector: `a[href^="${splashPrefix}"]`, prefix: splashPrefix },
    ];

    for (const { selector, prefix } of expectedLinks) {
      const link = page.locator(selector).first();
      await expect(link, `expected link with selector ${selector}`).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href, `href for ${selector}`).toBeTruthy();
      expect(
        href!.startsWith(prefix),
        `href ${href} should start with ${prefix}`,
      ).toBeTruthy();
    }
  });

  test('3. admin sees workspace via Coder API', async () => {
    let token: string;
    try {
      token = (await fs.readFile(CODER_TOKEN_PATH, 'utf8')).trim();
    } catch (e) {
      test.skip(true, `coder admin token not found at ${CODER_TOKEN_PATH}: ${String(e)}`);
      return;
    }
    expect(token).toBeTruthy();

    const res = await fetch(`${CODER_BASE}/api/v2/workspaces`, {
      headers: { 'Coder-Session-Token': token },
    });
    expect(res.ok, `coder workspaces api status=${res.status}`).toBeTruthy();
    const body = (await res.json()) as {
      workspaces?: Array<{
        name: string;
        latest_build?: { job?: { status?: string } };
      }>;
    };
    const list = body.workspaces ?? [];
    const ws = list.find((w) => w.name === sandboxName);
    expect(ws, `expected workspace ${sandboxName} in admin list`).toBeTruthy();
    expect(ws!.latest_build?.job?.status).toBe('succeeded');
  });

  test.afterAll(async () => {
    if (!sandboxId || !sessionCookie) {
      // eslint-disable-next-line no-console
      console.warn('[e2e] cleanup skipped: missing sandboxId or sessionCookie');
      return;
    }
    try {
      const res = await fetch(`${ONBOARDING_BASE}/api/sandboxes/${sandboxId}`, {
        method: 'DELETE',
        headers: { Cookie: `session=${sessionCookie}` },
      });
      // eslint-disable-next-line no-console
      console.log(`[e2e] cleanup DELETE /api/sandboxes/${sandboxId} -> ${res.status}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e] cleanup failed (non-fatal): ${String(e)}`);
    }
  });
});
