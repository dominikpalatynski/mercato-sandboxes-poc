import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('ensureCoderUser reuses an existing Coder account after a create conflict', async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'coder-test-'));
  const tokenFile = path.join(tempDir, 'coder-admin-token');
  writeFileSync(tokenFile, 'admin-token', 'utf8');

  const previousFetch = globalThis.fetch;
  const previousCoderUrl = process.env.CODER_URL;
  const previousTokenFile = process.env.CODER_ADMIN_TOKEN_FILE;

  process.env.CODER_URL = 'http://coder.test';
  process.env.CODER_ADMIN_TOKEN_FILE = tokenFile;

  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousCoderUrl == null) {
      delete process.env.CODER_URL;
    } else {
      process.env.CODER_URL = previousCoderUrl;
    }
    if (previousTokenFile == null) {
      delete process.env.CODER_ADMIN_TOKEN_FILE;
    } else {
      process.env.CODER_ADMIN_TOKEN_FILE = previousTokenFile;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const seenRequests: Array<{ method: string; url: string }> = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method || 'GET';
    seenRequests.push({ method, url });

    if (url === 'http://coder.test/api/v2/users/me') {
      return new Response(JSON.stringify({ organization_ids: ['org-1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url === 'http://coder.test/api/v2/users' && method === 'POST') {
      return new Response(JSON.stringify({ message: 'User already exists.' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url === 'http://coder.test/api/v2/users/user') {
      return new Response(JSON.stringify({
        id: 'coder-user-1',
        username: 'user',
        email: 'user@example.com',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url === 'http://coder.test/api/v2/users/coder-user-1/status/activate' && method === 'PUT') {
      return new Response(JSON.stringify({
        id: 'coder-user-1',
        username: 'user',
        email: 'user@example.com',
        status: 'active',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}`, import.meta.url);
  const { ensureCoderUser } = await import(moduleUrl.href);

  const user = await ensureCoderUser('user@example.com');

  assert.deepEqual(user, {
    id: 'coder-user-1',
    username: 'user',
    tempPassword: null,
  });

  assert.deepEqual(seenRequests, [
    { method: 'GET', url: 'http://coder.test/api/v2/users/me' },
    { method: 'POST', url: 'http://coder.test/api/v2/users' },
    { method: 'GET', url: 'http://coder.test/api/v2/users/user' },
    { method: 'PUT', url: 'http://coder.test/api/v2/users/coder-user-1/status/activate' },
  ]);
});

test('startWorkspace and stopWorkspace enqueue the expected Coder transitions', async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'coder-test-'));
  const tokenFile = path.join(tempDir, 'coder-admin-token');
  writeFileSync(tokenFile, 'admin-token', 'utf8');

  const previousFetch = globalThis.fetch;
  const previousCoderUrl = process.env.CODER_URL;
  const previousTokenFile = process.env.CODER_ADMIN_TOKEN_FILE;

  process.env.CODER_URL = 'http://coder.test';
  process.env.CODER_ADMIN_TOKEN_FILE = tokenFile;

  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousCoderUrl == null) {
      delete process.env.CODER_URL;
    } else {
      process.env.CODER_URL = previousCoderUrl;
    }
    if (previousTokenFile == null) {
      delete process.env.CODER_ADMIN_TOKEN_FILE;
    } else {
      process.env.CODER_ADMIN_TOKEN_FILE = previousTokenFile;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const seenRequests: Array<{ method: string; url: string; body: string | undefined }> = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    seenRequests.push({ method, url, body });

    if (url === 'http://coder.test/api/v2/workspaces/ws-1/builds' && method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-transitions`, import.meta.url);
  const { startWorkspace, stopWorkspace } = await import(moduleUrl.href);

  await startWorkspace('ws-1');
  await stopWorkspace('ws-1');

  assert.deepEqual(seenRequests, [
    {
      method: 'POST',
      url: 'http://coder.test/api/v2/workspaces/ws-1/builds',
      body: JSON.stringify({ transition: 'start', orphan: false }),
    },
    {
      method: 'POST',
      url: 'http://coder.test/api/v2/workspaces/ws-1/builds',
      body: JSON.stringify({ transition: 'stop', orphan: false }),
    },
  ]);
});

test('createWorkspace forwards the selected sandbox preset as a rich parameter', async (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'coder-test-'));
  const tokenFile = path.join(tempDir, 'coder-admin-token');
  const templateFile = path.join(tempDir, 'coder-template-id');
  writeFileSync(tokenFile, 'admin-token', 'utf8');
  writeFileSync(templateFile, 'template-1', 'utf8');

  const previousFetch = globalThis.fetch;
  const previousCoderUrl = process.env.CODER_URL;
  const previousTokenFile = process.env.CODER_ADMIN_TOKEN_FILE;
  const previousTemplateFile = process.env.CODER_TEMPLATE_ID_FILE;

  process.env.CODER_URL = 'http://coder.test';
  process.env.CODER_ADMIN_TOKEN_FILE = tokenFile;
  process.env.CODER_TEMPLATE_ID_FILE = templateFile;

  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousCoderUrl == null) {
      delete process.env.CODER_URL;
    } else {
      process.env.CODER_URL = previousCoderUrl;
    }
    if (previousTokenFile == null) {
      delete process.env.CODER_ADMIN_TOKEN_FILE;
    } else {
      process.env.CODER_ADMIN_TOKEN_FILE = previousTokenFile;
    }
    if (previousTemplateFile == null) {
      delete process.env.CODER_TEMPLATE_ID_FILE;
    } else {
      process.env.CODER_TEMPLATE_ID_FILE = previousTemplateFile;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const seenRequests: Array<{ method: string; url: string; body: string | undefined }> = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    seenRequests.push({ method, url, body });

    if (url === 'http://coder.test/api/v2/users/me') {
      return new Response(JSON.stringify({ organization_ids: ['org-1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url === 'http://coder.test/api/v2/organizations/org-1/members/coder-user-1/workspaces' && method === 'POST') {
      return new Response(JSON.stringify({ id: 'workspace-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-create-workspace`, import.meta.url);
  const { createWorkspace } = await import(moduleUrl.href);

  const workspace = await createWorkspace('coder-user-1', 'classic-demo', {
    sandboxPreset: 'classic',
    workspaceCredsSecretName: 'mercato-workspace-creds-sandbox-1',
  });

  assert.deepEqual(workspace, { id: 'workspace-1' });
  const createRequest = seenRequests.at(-1);
  assert.deepEqual(createRequest, {
    method: 'POST',
    url: 'http://coder.test/api/v2/organizations/org-1/members/coder-user-1/workspaces',
    body: JSON.stringify({
      name: 'classic-demo',
      template_id: 'template-1',
      rich_parameter_values: [
        {
          name: 'sandbox_preset',
          value: 'classic',
        },
        {
          name: 'mercato_creds_secret_name',
          value: 'mercato-workspace-creds-sandbox-1',
        },
      ],
      automatic_updates: 'never',
    }),
  });
});

test('resolveAppUrl expands a bare subdomain_name label into the wildcard apps domain and preserves the public port', async () => {
  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-subdomain`, import.meta.url);
  const { resolveAppUrl } = await import(moduleUrl.href);

  const url = resolveAppUrl({
    apps: [
      {
        slug: 'app',
        display_name: 'Mercato App',
        url: 'http://localhost:3000',
        external: false,
        subdomain: true,
        subdomain_name: '3000--main--crm-demo--darek',
      },
    ],
    slug: 'app',
    coderPublicUrl: 'https://coder.sandbox.lvh.me:8443',
    ownerName: 'darek',
    name: 'crm-demo',
  });

  assert.equal(url, 'https://3000--main--crm-demo--darek.apps.sandbox.lvh.me:8443/');
});

test('resolveAppUrl preserves the original path and query for subdomain apps such as code-server', async () => {
  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-subdomain-query`, import.meta.url);
  const { resolveAppUrl } = await import(moduleUrl.href);

  const url = resolveAppUrl({
    apps: [
      {
        slug: 'code-server',
        display_name: 'VS Code',
        url: 'http://localhost:13337/?folder=/home/coder/app',
        external: false,
        subdomain: true,
        subdomain_name: 'code-server--crm-demo--darek',
      },
    ],
    slug: 'code-server',
    coderPublicUrl: 'https://coder.sandbox.lvh.me:8443',
    ownerName: 'darek',
    name: 'crm-demo',
  });

  assert.equal(url, 'https://code-server--crm-demo--darek.apps.sandbox.lvh.me:8443/?folder=/home/coder/app');
});

test('resolveAppUrl leaves fully-qualified subdomain_name values intact', async () => {
  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-subdomain-fqdn`, import.meta.url);
  const { resolveAppUrl } = await import(moduleUrl.href);

  const url = resolveAppUrl({
    apps: [
      {
        slug: 'splash',
        display_name: 'Mercato Splash',
        url: 'http://localhost:4000',
        external: false,
        subdomain: true,
        subdomain_name: '4000--main--crm-demo--darek.apps.sandbox.lvh.me',
      },
    ],
    slug: 'splash',
    coderPublicUrl: 'https://coder.sandbox.lvh.me:8443',
    ownerName: 'darek',
    name: 'crm-demo',
  });

  assert.equal(url, 'https://4000--main--crm-demo--darek.apps.sandbox.lvh.me:8443/');
});

test('resolveAppUrl keeps the path-based fallback for non-subdomain internal apps', async () => {
  const moduleUrl = new URL(`../lib/coder.ts?case=${Date.now()}-path`, import.meta.url);
  const { resolveAppUrl } = await import(moduleUrl.href);

  const url = resolveAppUrl({
    apps: [
      {
        slug: 'app',
        display_name: 'Mercato App',
        url: 'http://localhost:3000',
        external: false,
        subdomain: false,
        subdomain_name: null,
      },
    ],
    slug: 'app',
    coderPublicUrl: 'https://coder.sandbox.lvh.me:8443',
    ownerName: 'darek',
    name: 'crm-demo',
  });

  assert.equal(url, 'https://coder.sandbox.lvh.me:8443/@darek/crm-demo/apps/app');
});
