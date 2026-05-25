import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenRouterKey, OpenRouterApiError } from '../lib/openrouter';

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('createOpenRouterKey reads the raw key from the top-level OpenRouter response', async (t) => {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousManagementKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  const previousManagementApiKey = process.env.OPENROUTER_MANAGEMENT_API_KEY;

  process.env.OPENROUTER_BASE_URL = 'http://openrouter.test/api/v1';
  process.env.OPENROUTER_MANAGEMENT_KEY = 'management-key';
  delete process.env.OPENROUTER_MANAGEMENT_API_KEY;

  t.after(() => {
    globalThis.fetch = previousFetch;
    restoreEnv('OPENROUTER_BASE_URL', previousBaseUrl);
    restoreEnv('OPENROUTER_MANAGEMENT_KEY', previousManagementKey);
    restoreEnv('OPENROUTER_MANAGEMENT_API_KEY', previousManagementApiKey);
  });

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://openrouter.test/api/v1/keys');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer management-key');

    return new Response(
      JSON.stringify({
        data: {
          hash: 'hash-1',
          label: 'sk-or-v1-abc...xyz',
          name: 'Open Mercato',
          limit: 50,
          limit_remaining: 50,
          limit_reset: null,
          usage: 0,
          usage_monthly: 0,
          disabled: false,
        },
        key: 'sk-or-v1-raw-secret',
      }),
      {
        status: 201,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  const key = await createOpenRouterKey({
    name: 'Open Mercato',
    limit: 50,
    limit_reset: null,
  });

  assert.equal(key.hash, 'hash-1');
  assert.equal(key.label, 'sk-or-v1-abc...xyz');
  assert.equal(key.key, 'sk-or-v1-raw-secret');
});

test('createOpenRouterKey fails when OpenRouter omits the one-time raw key', async (t) => {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousManagementKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  const previousManagementApiKey = process.env.OPENROUTER_MANAGEMENT_API_KEY;

  process.env.OPENROUTER_BASE_URL = 'http://openrouter.test/api/v1';
  process.env.OPENROUTER_MANAGEMENT_KEY = 'management-key';
  delete process.env.OPENROUTER_MANAGEMENT_API_KEY;

  t.after(() => {
    globalThis.fetch = previousFetch;
    restoreEnv('OPENROUTER_BASE_URL', previousBaseUrl);
    restoreEnv('OPENROUTER_MANAGEMENT_KEY', previousManagementKey);
    restoreEnv('OPENROUTER_MANAGEMENT_API_KEY', previousManagementApiKey);
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          hash: 'hash-without-key',
          label: 'sk-or-v1-abc...xyz',
          name: 'Open Mercato',
          limit: 50,
          limit_remaining: 50,
          limit_reset: null,
          usage: 0,
          usage_monthly: 0,
          disabled: false,
        },
      }),
      {
        status: 201,
        headers: { 'content-type': 'application/json' },
      },
    );

  await assert.rejects(
    () =>
      createOpenRouterKey({
        name: 'Open Mercato',
        limit: 50,
        limit_reset: null,
      }),
    (error) =>
      error instanceof OpenRouterApiError &&
      error.status === 502 &&
      error.message.includes('raw key'),
  );
});
