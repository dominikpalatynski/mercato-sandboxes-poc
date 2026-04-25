import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Full happy-path onboarding flow per .ai/SPEC.md §6.
 *
 * Tests share state through module-scope variables; describe.serial guarantees
 * sequential execution. Each test gets a fresh browser context, so we capture
 * the session cookie in test 1 and reuse it for the cleanup hook.
 */

const PASSWORD = 'Sup3rSecret!';
const ONBOARDING_BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CODER_BASE = process.env.CODER_BASE_URL ?? 'https://coder.sandbox.lvh.me';
const CODER_TOKEN_PATH = path.resolve(__dirname, '../../.runtime/coder-admin-token');
// App + splash + VS Code are now served by Coder's native wildcard access URL
// in port-based form: `{port}--main--{ws}--{user}.{WILDCARD_APPS_DOMAIN}`.
// Override env vars to match a non-default deployment.
const WILDCARD_APPS_DOMAIN = process.env.WILDCARD_APPS_DOMAIN ?? 'apps.sandbox.lvh.me';
const SANDBOX_DOMAIN = process.env.SANDBOX_DOMAIN ?? 'sandbox.lvh.me';
const PROXY_SCHEME = process.env.PROXY_SCHEME ?? 'https';
const PROXY_PORT_SUFFIX = process.env.PROXY_PORT_SUFFIX ?? '';

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
    await page.getByRole('link', { name: /open in vs code/i }).waitFor({ timeout: 600_000 });
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    // eslint-disable-next-line no-console
    console.log(`[e2e] workspace ready after ~${elapsedSec}s`);

    // VS Code, app, and splash all live on Coder's port-based wildcard.
    // Onboarding wraps every link through /api/coder-login?next=<encoded>, so
    // the visible href starts with that, and the encoded `next=` param has
    // the wildcard URL. Terminal stays path-based on Coder.
    const codePrefix = `${PROXY_SCHEME}://13337--main--${sandboxName}--${coderUsername}.${WILDCARD_APPS_DOMAIN}${PROXY_PORT_SUFFIX}`;
    const appPrefix = `${PROXY_SCHEME}://3000--main--${sandboxName}--${coderUsername}.${WILDCARD_APPS_DOMAIN}${PROXY_PORT_SUFFIX}`;
    const splashPrefix = `${PROXY_SCHEME}://4000--main--${sandboxName}--${coderUsername}.${WILDCARD_APPS_DOMAIN}${PROXY_PORT_SUFFIX}`;
    const terminalPrefix = `${CODER_BASE}/@${coderUsername}/${sandboxName}/terminal`;

    // The visible card hrefs are `/api/coder-login?...&next=<encoded target>`.
    // We check the decoded `next` param starts with the expected prefix —
    // robust to whether the test runs against the dev (`viaCoderLogin: true`)
    // or production code path.
    const expectedTargets: ReadonlyArray<{ label: string; prefix: string }> = [
      { label: 'Open in VS Code', prefix: codePrefix },
      { label: 'Open Terminal', prefix: terminalPrefix },
      { label: 'Open Mercato App', prefix: appPrefix },
      { label: 'Open Splash', prefix: splashPrefix },
    ];

    for (const { label, prefix } of expectedTargets) {
      const link = page.getByRole('link', { name: new RegExp(label, 'i') }).first();
      await expect(link, `expected link "${label}"`).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href, `href for "${label}"`).toBeTruthy();
      // Either a direct link OR a /api/coder-login wrapper around it.
      let target = href!;
      if (target.startsWith('/api/coder-login')) {
        const u = new URL(target, ONBOARDING_BASE);
        target = u.searchParams.get('next') ?? '';
      }
      expect(
        target.startsWith(prefix),
        `target ${target} should start with ${prefix}`,
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

  test('4. one-click VS Code + terminal — no Coder login form', async ({ page, context }) => {
    // Re-establish auth on a fresh context.
    await context.addCookies([
      { name: 'session', value: sessionCookie, url: ONBOARDING_BASE },
    ]);
    await page.goto(`/sandboxes/${sandboxId}`);
    await page.waitForSelector(`a:has-text("Open in VS Code")`);

    // VS Code: click → wait for the wildcard host. Coder must NOT show its
    // sign-in form (no password field).
    const [vscodeTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /open in vs code/i }).first().click(),
    ]);
    await vscodeTab.waitForURL(
      new RegExp(`13337--main--${sandboxName}--${coderUsername}\\.${WILDCARD_APPS_DOMAIN.replace(/\./g, '\\.')}`),
      { timeout: 30_000 },
    );
    // Give code-server a moment to render its initial chrome (or for Coder to
    // bounce the request). Then check for the absence of a Coder login form.
    await vscodeTab.waitForLoadState('domcontentloaded');
    const vscodePassword = await vscodeTab.locator('input[type="password"]').count();
    expect(
      vscodePassword,
      'Coder login form (password field) appeared on VS Code tab — auto-login broken',
    ).toBe(0);
    await vscodeTab.close();

    // Terminal: same drill, path-based URL.
    const [termTab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: /open terminal/i }).first().click(),
    ]);
    await termTab.waitForURL(
      new RegExp(`/@${coderUsername}/${sandboxName}/terminal`),
      { timeout: 30_000 },
    );
    await termTab.waitForLoadState('domcontentloaded');
    const termPassword = await termTab.locator('input[type="password"]').count();
    expect(
      termPassword,
      'Coder login form (password field) appeared on Terminal tab — auto-login broken',
    ).toBe(0);
    await termTab.close();
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
