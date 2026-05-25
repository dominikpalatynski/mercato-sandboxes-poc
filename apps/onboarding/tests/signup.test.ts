import assert from 'node:assert/strict';
import test from 'node:test';

import { registerUser, SignupError, type SignupRepository } from '../lib/signup';

interface InsertedUserCall {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  crmEntityId: string | null;
  crmPersonId: string | null;
}

function makeRepo(overrides: Partial<SignupRepository> = {}): {
  repo: SignupRepository;
  inserts: InsertedUserCall[];
  giteaUpdates: Array<{ userId: string; orgName: string }>;
} {
  const inserts: InsertedUserCall[] = [];
  const giteaUpdates: Array<{ userId: string; orgName: string }> = [];
  const repo: SignupRepository = {
    findUserIdByEmail: overrides.findUserIdByEmail ?? (async () => null),
    insertUser:
      overrides.insertUser ??
      (async (input) => {
        inserts.push(input);
        return { id: 'user-1', email: input.email };
      }),
    setUserGiteaOrg:
      overrides.setUserGiteaOrg ??
      (async (userId, orgName) => {
        giteaUpdates.push({ userId, orgName });
      }),
  };
  return { repo, inserts, giteaUpdates };
}

test('registerUser stores CRM customer identifiers returned during signup sync', async () => {
  const { repo, inserts } = makeRepo();

  const created = await registerUser(
    {
      email: 'Owner@Example.com',
      password: 'supersecret123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyName: 'Analytical Engines',
    },
    {
      repository: repo,
      hashPassword: async () => 'hashed-password',
      signSession: async () => 'session-token',
      syncOpenMercatoSignupCustomer: async () => ({
        entityId: 'entity-1',
        personId: 'person-1',
        created: true,
      }),
      createUserOrg: async () => ({ name: 'user-test', id: 1 }),
    },
  );

  assert.equal(created.userId, 'user-1');
  assert.equal(created.sessionToken, 'session-token');
  assert.equal(created.openMercatoCustomerEntityId, 'entity-1');
  assert.equal(created.openMercatoCustomerPersonId, 'person-1');
  assert.deepEqual(inserts[0], {
    email: 'owner@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Ada',
    lastName: 'Lovelace',
    companyName: 'Analytical Engines',
    crmEntityId: 'entity-1',
    crmPersonId: 'person-1',
  });
});

test('registerUser allows signup without CRM sync when the feature is not configured', async () => {
  const { repo, inserts } = makeRepo();

  const created = await registerUser(
    {
      email: 'owner@example.com',
      password: 'supersecret123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      companyName: null,
    },
    {
      repository: repo,
      hashPassword: async () => 'hashed-password',
      signSession: async () => 'session-token',
      syncOpenMercatoSignupCustomer: async () => null,
      createUserOrg: async () => ({ name: 'user-test', id: 1 }),
    },
  );

  assert.equal(created.openMercatoCustomerEntityId, null);
  assert.equal(created.openMercatoCustomerPersonId, null);
  assert.deepEqual(inserts[0], {
    email: 'owner@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Ada',
    lastName: 'Lovelace',
    companyName: null,
    crmEntityId: null,
    crmPersonId: null,
  });
});

test('registerUser rejects duplicate emails before attempting CRM sync', async () => {
  let syncCalls = 0;
  const { repo } = makeRepo({
    findUserIdByEmail: async () => 'user-existing',
  });

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
          repository: repo,
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
  const { repo } = makeRepo({
    insertUser: async (input) => {
      insertCalled = true;
      return { id: 'user-x', email: input.email };
    },
  });

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
          repository: repo,
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
