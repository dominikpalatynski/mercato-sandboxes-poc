import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenMercatoClient,
  OpenMercatoClient,
  OpenMercatoClientError,
  OPENMERCATO_API_KEY_HEADER,
  resolveOpenMercatoApiBaseUrl,
  resolveOpenMercatoApiKey,
} from '../lib/openmercato-client';

test('resolveOpenMercatoApiBaseUrl prefers the generic API URL and falls back to the billing URL', () => {
  assert.equal(
    resolveOpenMercatoApiBaseUrl({
      OPENMERCATO_API_BASE_URL: 'https://om.example/api/',
      OPENMERCATO_BILLING_BASE_URL: 'https://billing.example',
    }),
    'https://om.example/api',
  );

  assert.equal(
    resolveOpenMercatoApiBaseUrl({
      OPENMERCATO_BILLING_BASE_URL: 'https://billing.example/',
    }),
    'https://billing.example',
  );
});

test('resolveOpenMercatoApiKey requires OPENMERCATO_API_KEY', () => {
  assert.equal(
    resolveOpenMercatoApiKey({ OPENMERCATO_API_KEY: 'omk_test_123' }),
    'omk_test_123',
  );
  assert.throws(() => resolveOpenMercatoApiKey({}), /OPENMERCATO_API_KEY is not configured/);
});

test('OpenMercatoClient sends x-api-key auth, strips authorization, and serializes JSON bodies', async () => {
  let requestedUrl: string | null = null;
  let requestedMethod: string | null = null;
  let requestedHeaders = new Headers();
  let requestedBody: string | null = null;

  const client = new OpenMercatoClient({
    apiKey: 'omk_secret',
    baseUrl: 'https://om.example/root',
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? 'GET';
      requestedHeaders = new Headers(init?.headers);
      requestedBody = typeof init?.body === 'string' ? init.body : null;
      return Response.json({ ok: true });
    },
  });

  const response = await client.post<{ ok: boolean }>(
    '/api/sandbox-billing/customer-sync',
    { email: 'owner@example.com' },
    {
      headers: {
        Authorization: 'Bearer should-not-leak',
        'x-api-key': 'should-not-override',
        'x-trace-id': 'trace-1',
      },
      query: {
        sync: true,
        tags: ['sandbox', 'billing'],
      },
    },
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(
    requestedUrl,
    'https://om.example/root/api/sandbox-billing/customer-sync?sync=true&tags=sandbox&tags=billing',
  );
  assert.equal(requestedMethod, 'POST');
  assert.equal(requestedHeaders.get(OPENMERCATO_API_KEY_HEADER), 'omk_secret');
  assert.equal(requestedHeaders.get('authorization'), null);
  assert.equal(requestedHeaders.get('content-type'), 'application/json');
  assert.equal(requestedHeaders.get('accept'), 'application/json');
  assert.equal(requestedHeaders.get('x-trace-id'), 'trace-1');
  assert.equal(requestedBody, JSON.stringify({ email: 'owner@example.com' }));
});

test('createOpenMercatoClient builds a client from explicit env-derived options', async () => {
  const client = createOpenMercatoClient({
    apiKey: resolveOpenMercatoApiKey({ OPENMERCATO_API_KEY: 'omk_explicit' }),
    baseUrl: resolveOpenMercatoApiBaseUrl({
      OPENMERCATO_API_BASE_URL: 'https://om.example',
    }),
    fetch: async () => Response.json({ pong: true }),
  });

  await assert.doesNotReject(() => client.get('/api/ping'));
});

test('OpenMercatoClient exposes structured request errors', async () => {
  const client = new OpenMercatoClient({
    apiKey: 'omk_secret',
    baseUrl: 'https://om.example',
    fetch: async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-123',
        },
      }),
  });

  await assert.rejects(
    () => client.get('/api/sandbox-billing/plans'),
    (error: unknown) => {
      assert.ok(error instanceof OpenMercatoClientError);
      assert.equal(error.status, 401);
      assert.equal(error.requestId, 'req-123');
      assert.equal(error.method, 'GET');
      assert.equal(error.url, 'https://om.example/api/sandbox-billing/plans');
      assert.match(error.body, /Unauthorized/);
      return true;
    },
  );
});
