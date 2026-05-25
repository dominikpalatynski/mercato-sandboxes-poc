import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSandboxQuotaAvailable,
  buildSandboxQuota,
  readSandboxQuotaLimit,
  SandboxQuotaError,
} from '../lib/sandbox-quota';

test('readSandboxQuotaLimit accepts non-negative integer sandboxCount values', () => {
  assert.equal(readSandboxQuotaLimit({ sandboxCount: 1 }), 1);
  assert.equal(readSandboxQuotaLimit({ sandboxCount: 0 }), 0);
});

test('readSandboxQuotaLimit rejects missing or malformed sandboxCount values', () => {
  assert.equal(readSandboxQuotaLimit(null), null);
  assert.equal(readSandboxQuotaLimit({ sandboxCount: '1' }), null);
  assert.equal(readSandboxQuotaLimit({ sandboxCount: 1.5 }), null);
  assert.equal(readSandboxQuotaLimit({ sandboxCount: -1 }), null);
});

test('assertSandboxQuotaAvailable rejects reached quotas', () => {
  const quota = buildSandboxQuota({ sandboxCount: 1 }, 1);
  assert.throws(
    () => assertSandboxQuotaAvailable(quota),
    (error: unknown) => {
      assert.ok(error instanceof SandboxQuotaError);
      assert.equal(error.code, 'sandbox_limit_reached');
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test('assertSandboxQuotaAvailable rejects unavailable quotas', () => {
  const quota = buildSandboxQuota({ openRouterTokensUsageUsd: 50 }, 0);
  assert.throws(
    () => assertSandboxQuotaAvailable(quota),
    (error: unknown) => {
      assert.ok(error instanceof SandboxQuotaError);
      assert.equal(error.code, 'sandbox_quota_unavailable');
      assert.equal(error.status, 409);
      return true;
    },
  );
});
