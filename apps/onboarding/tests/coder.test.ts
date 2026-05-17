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
