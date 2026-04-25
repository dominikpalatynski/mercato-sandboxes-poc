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

    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
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

    const expectedSubstrings = [
      '/apps/code-server',
      '/apps/splash',
      '/apps/app',
      '/terminal',
    ] as const;

    for (const sub of expectedSubstrings) {
      const link = page.locator(`a[href*="${sub}"]`).first();
      await expect(link, `expected link containing ${sub}`).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href, `href for ${sub}`).toBeTruthy();
      const expectedPrefix = `${CODER_BASE}/@${coderUsername}/${sandboxName}/`;
      expect(
        href!.startsWith(expectedPrefix),
        `href ${href} should start with ${expectedPrefix}`,
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
