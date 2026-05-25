import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSubscriptionCheckout,
  createSubscriptionPortal,
  getSubscriptionAccess,
  hasGrantedAccess,
  readEntitlementsView,
  SUBSCRIPTION_SUBJECT_ENTITY_TYPE,
  type OpenMercatoSubscriptionsClientDependencies,
  type SubscriptionAccessSnapshot,
} from '../lib/openmercato-subscriptions';

test('createSubscriptionCheckout posts to OM subscriptions endpoint with subject entity type', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async get() {
      throw new Error('get should not be called');
    },
    async post(path: string, body?: Record<string, unknown>) {
      calls.push({ path, body: body ?? {} });
      return {
        checkoutUrl: 'https://checkout.stripe.com/abc',
        provider: 'stripe' as const,
        subscriptionRequestId: '11111111-1111-4111-8111-111111111111',
      };
    },
  };

  const result = await createSubscriptionCheckout(
    {
      externalAccountId: 'user-abc',
      subjectEntityId: '22222222-2222-4222-8222-222222222222',
      successUrl: 'https://app.example/billing?status=success',
      cancelUrl: 'https://app.example/billing?status=cancelled',
    },
    { client: client as OpenMercatoSubscriptionsClientDependencies['client'] },
  );

  assert.equal(result.provider, 'stripe');
  assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/abc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, '/api/subscriptions/checkout');
  assert.deepEqual(calls[0]!.body, {
    externalAccountId: 'user-abc',
    subjectEntityType: SUBSCRIPTION_SUBJECT_ENTITY_TYPE,
    subjectEntityId: '22222222-2222-4222-8222-222222222222',
    priceCode: 'basic-monthly-pln-v1',
    successUrl: 'https://app.example/billing?status=success',
    cancelUrl: 'https://app.example/billing?status=cancelled',
  });
});

test('createSubscriptionCheckout forwards explicit priceCode and metadata', async () => {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const client = {
    async get() {
      throw new Error('get should not be called');
    },
    async post(_path: string, body?: Record<string, unknown>) {
      calls.push({ body: body ?? {} });
      return {
        checkoutUrl: 'https://checkout.example',
        provider: 'stripe' as const,
        subscriptionRequestId: '33333333-3333-4333-8333-333333333333',
      };
    },
  };

  await createSubscriptionCheckout(
    {
      externalAccountId: 'user-xyz',
      subjectEntityId: '44444444-4444-4444-8444-444444444444',
      priceCode: 'premium-monthly-pln-v1',
      successUrl: 'https://app.example/billing?status=success',
      cancelUrl: 'https://app.example/billing?status=cancelled',
      metadata: { trace: 'abc' },
    },
    { client: client as OpenMercatoSubscriptionsClientDependencies['client'] },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.body.priceCode, 'premium-monthly-pln-v1');
  assert.deepEqual(calls[0]!.body.metadata, { trace: 'abc' });
});

test('createSubscriptionPortal posts to OM subscriptions portal endpoint', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async get() {
      throw new Error('get should not be called');
    },
    async post(path: string, body?: Record<string, unknown>) {
      calls.push({ path, body: body ?? {} });
      return {
        portalUrl: 'https://billing.stripe.com/session/abc',
      };
    },
  };

  const result = await createSubscriptionPortal(
    {
      externalAccountId: 'user-abc',
      returnUrl: 'https://app.example/billing',
    },
    { client: client as OpenMercatoSubscriptionsClientDependencies['client'] },
  );

  assert.equal(result.portalUrl, 'https://billing.stripe.com/session/abc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, '/api/subscriptions/portal');
  assert.deepEqual(calls[0]!.body, {
    externalAccountId: 'user-abc',
    returnUrl: 'https://app.example/billing',
  });
});

test('getSubscriptionAccess queries the OM access endpoint with defaults', async () => {
  const snapshot: SubscriptionAccessSnapshot = {
    subscriptionId: '55555555-5555-4555-8555-555555555555',
    externalAccountId: 'user-abc',
    productCode: 'basic-sandbox',
    planCode: 'basic',
    priceCode: 'basic-monthly-pln-v1',
    provider: 'stripe',
    providerStatus: 'active',
    accessState: 'granted',
    currentPeriodStart: '2026-05-01T00:00:00.000Z',
    currentPeriodEnd: '2026-06-01T00:00:00.000Z',
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    entitlements: { sandboxCount: 1, openRouterTokensUsageUsd: 50 },
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
  const calls: Array<{ path: string; query: Record<string, unknown> | undefined }> = [];
  const client = {
    async get(path: string, options?: { query?: Record<string, unknown> }) {
      calls.push({ path, query: options?.query });
      return snapshot;
    },
    async post() {
      throw new Error('post should not be called');
    },
  };

  const result = await getSubscriptionAccess(
    { externalAccountId: 'user-abc' },
    { client: client as OpenMercatoSubscriptionsClientDependencies['client'] },
  );
  assert.equal(result.accessState, 'granted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, '/api/subscriptions/access');
  assert.deepEqual(calls[0]!.query, {
    externalAccountId: 'user-abc',
    productCode: 'basic-sandbox',
  });
});

test('readEntitlementsView extracts known numeric entitlement fields', () => {
  const view = readEntitlementsView({ sandboxCount: 1, openRouterTokensUsageUsd: 50 });
  assert.deepEqual(view, { sandboxCount: 1, openRouterTokensUsageUsd: 50 });

  const empty = readEntitlementsView(null);
  assert.deepEqual(empty, { sandboxCount: null, openRouterTokensUsageUsd: null });

  const partial = readEntitlementsView({ sandboxCount: 1 });
  assert.equal(partial.sandboxCount, 1);
  assert.equal(partial.openRouterTokensUsageUsd, null);

  const malformed = readEntitlementsView({ openRouterTokensUsageUsd: '50' });
  assert.equal(malformed.openRouterTokensUsageUsd, null);
});

test('hasGrantedAccess accepts granted and grace, rejects pending and blocked', () => {
  const snapshot = (state: SubscriptionAccessSnapshot['accessState']): SubscriptionAccessSnapshot => ({
    subscriptionId: null,
    externalAccountId: 'x',
    productCode: 'basic-sandbox',
    planCode: null,
    priceCode: null,
    provider: null,
    providerStatus: null,
    accessState: state,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    entitlements: null,
    updatedAt: null,
  });

  assert.equal(hasGrantedAccess(snapshot('granted')), true);
  assert.equal(hasGrantedAccess(snapshot('grace')), true);
  assert.equal(hasGrantedAccess(snapshot('pending')), false);
  assert.equal(hasGrantedAccess(snapshot('blocked')), false);
  assert.equal(hasGrantedAccess(null), false);
});
