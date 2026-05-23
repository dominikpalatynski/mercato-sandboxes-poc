import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveOpenMercatoCustomerScope,
  syncOpenMercatoSignupCustomer,
} from '../lib/openmercato-customers';

test('resolveOpenMercatoCustomerScope returns null when CRM signup sync env is absent', () => {
  assert.equal(resolveOpenMercatoCustomerScope({}), null);
});

test('resolveOpenMercatoCustomerScope rejects partial CRM signup sync configuration', () => {
  assert.throws(
    () =>
      resolveOpenMercatoCustomerScope({
        OPENMERCATO_CUSTOMER_TENANT_ID: 'tenant-1',
      }),
    /requires both OPENMERCATO_CUSTOMER_TENANT_ID and OPENMERCATO_CUSTOMER_ORGANIZATION_ID/,
  );
});

test('syncOpenMercatoSignupCustomer reuses an existing CRM person matched by email', async () => {
  const requests: string[] = [];
  const client = {
    async get(path: string, options?: { query?: Record<string, unknown> }) {
      requests.push(`${path}?${new URLSearchParams(options?.query as Record<string, string>).toString()}`);
      if (path === '/api/customers/people') {
        return { items: [{ id: 'entity-1' }] };
      }
      if (path === '/api/customers/people/entity-1') {
        return { profile: { id: 'person-1' } };
      }
      throw new Error(`Unexpected path ${path}`);
    },
    async post() {
      throw new Error('post should not be called when CRM person already exists');
    },
  };

  const result = await syncOpenMercatoSignupCustomer(
    {
      email: 'Owner@Example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    {
      client,
      env: {
        OPENMERCATO_CUSTOMER_TENANT_ID: 'tenant-1',
        OPENMERCATO_CUSTOMER_ORGANIZATION_ID: 'org-1',
      },
    },
  );

  assert.deepEqual(result, {
    entityId: 'entity-1',
    personId: 'person-1',
    created: false,
  });
  assert.equal(
    requests[0],
    '/api/customers/people?email=owner%40example.com&page=1&pageSize=1',
  );
  assert.equal(requests[1], '/api/customers/people/entity-1?');
});

test('syncOpenMercatoSignupCustomer creates a CRM person with env-provided scope when no match exists', async () => {
  const requests: Array<{
    method: 'get' | 'post';
    path: string;
    body?: Record<string, string>;
  }> = [];

  const client = {
    async get(path: string) {
      requests.push({ method: 'get', path });
      return { items: [] };
    },
    async post(path: string, body?: Record<string, string>) {
      requests.push({ method: 'post', path, body });
      return { entityId: 'entity-2', personId: 'person-2' };
    },
  };

  const result = await syncOpenMercatoSignupCustomer(
    {
      email: 'Owner@Example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    {
      client,
      env: {
        OPENMERCATO_CUSTOMER_TENANT_ID: 'tenant-1',
        OPENMERCATO_CUSTOMER_ORGANIZATION_ID: 'org-1',
      },
    },
  );

  assert.deepEqual(result, {
    entityId: 'entity-2',
    personId: 'person-2',
    created: true,
  });
  assert.deepEqual(requests, [
    {
      method: 'get',
      path: '/api/customers/people',
    },
    {
      method: 'post',
      path: '/api/customers/people',
      body: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Ada Lovelace',
        primaryEmail: 'owner@example.com',
        source: 'sandbox_onboarding',
      },
    },
  ]);
});
