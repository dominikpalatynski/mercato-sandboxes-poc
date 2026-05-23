import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResult, QueryResultRow } from 'pg';

import { registerUser, SignupError } from '../lib/signup';

function result<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount,
    rows,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

test('registerUser stores CRM customer identifiers returned during signup sync', async () => {
  const inserts: unknown[][] = [];

  const query = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    const text = normalizeSql(sql);
    if (text === 'select id from users where email = $1') {
      return result([] as T[], 0);
    }
    if (text.startsWith('insert into users (')) {
      inserts.push(params);
      return result([{ id: 'user-1', email: 'owner@example.com' } as T], 1);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const created = await registerUser(
    {
      email: 'Owner@Example.com',
      password: 'supersecret123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyName: 'Analytical Engines',
    },
    {
      query,
      hashPassword: async () => 'hashed-password',
      signSession: async () => 'session-token',
      syncOpenMercatoSignupCustomer: async () => ({
        entityId: 'entity-1',
        personId: 'person-1',
        created: true,
      }),
    },
  );

  assert.equal(created.userId, 'user-1');
  assert.equal(created.sessionToken, 'session-token');
  assert.equal(created.openMercatoCustomerEntityId, 'entity-1');
  assert.equal(created.openMercatoCustomerPersonId, 'person-1');
  assert.deepEqual(inserts[0], [
    'owner@example.com',
    'hashed-password',
    'Ada',
    'Lovelace',
    'Analytical Engines',
    'entity-1',
    'person-1',
  ]);
});

test('registerUser allows signup without CRM sync when the feature is not configured', async () => {
  const inserts: unknown[][] = [];

  const query = async <T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    const text = normalizeSql(sql);
    if (text === 'select id from users where email = $1') {
      return result([] as T[], 0);
    }
    if (text.startsWith('insert into users (')) {
      inserts.push(params);
      return result([{ id: 'user-2', email: 'owner@example.com' } as T], 1);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const created = await registerUser(
    {
      email: 'owner@example.com',
      password: 'supersecret123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyName: null,
    },
    {
      query,
      hashPassword: async () => 'hashed-password',
      signSession: async () => 'session-token',
      syncOpenMercatoSignupCustomer: async () => null,
    },
  );

  assert.equal(created.openMercatoCustomerEntityId, null);
  assert.equal(created.openMercatoCustomerPersonId, null);
  assert.deepEqual(inserts[0], [
    'owner@example.com',
    'hashed-password',
    'Ada',
    'Lovelace',
    null,
    null,
    null,
  ]);
});

test('registerUser rejects duplicate emails before attempting CRM sync', async () => {
  let syncCalls = 0;

  const query = async <T extends QueryResultRow>(): Promise<QueryResult<T>> =>
    result([{ id: 'user-existing' } as T], 1);

  await assert.rejects(
    () =>
      registerUser(
        {
          email: 'owner@example.com',
          password: 'supersecret123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyName: null,
        },
        {
          query,
          syncOpenMercatoSignupCustomer: async () => {
            syncCalls += 1;
            return null;
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof SignupError);
      assert.equal(error.status, 409);
      assert.equal(error.message, 'Email already registered');
      assert.equal(syncCalls, 0);
      return true;
    },
  );
});

test('registerUser surfaces CRM sync failures as signup dependency errors', async () => {
  let insertCalled = false;

  const query = async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
    const text = normalizeSql(sql);
    if (text === 'select id from users where email = $1') {
      return result([] as T[], 0);
    }
    insertCalled = true;
    throw new Error('insert should not be reached when CRM sync fails');
  };

  await assert.rejects(
    () =>
      registerUser(
        {
          email: 'owner@example.com',
          password: 'supersecret123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          companyName: null,
        },
        {
          query,
          syncOpenMercatoSignupCustomer: async () => {
            throw new Error('crm unavailable');
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof SignupError);
      assert.equal(error.status, 502);
      assert.equal(error.message, 'Failed to create CRM customer');
      assert.equal(insertCalled, false);
      return true;
    },
  );
});
