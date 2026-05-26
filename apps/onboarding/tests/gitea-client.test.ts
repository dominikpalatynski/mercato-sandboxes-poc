import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOrgName } from '../lib/gitea/client';

test('buildOrgName derives a human-readable slug from the email local-part', () => {
  const owner = buildOrgName('palatynski.dominik@gmail.com', '02c2f38f-241a-4d4d-a4d1-817d1566480c');
  assert.match(owner, /^palatynski-dominik-[a-f0-9]{4}$/);
  assert.ok(owner.length <= 40);
});

test('buildOrgName is deterministic for the same (email, userId) pair', () => {
  const a = buildOrgName('user@example.com', 'abc-123');
  const b = buildOrgName('user@example.com', 'abc-123');
  assert.equal(a, b);
});

test('buildOrgName disambiguates two users sharing an email local-part', () => {
  const a = buildOrgName('alex@one.com', 'id-one');
  const b = buildOrgName('alex@two.com', 'id-two');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('alex-'));
  assert.ok(b.startsWith('alex-'));
});

test('buildOrgName falls back to `user-<suffix>` when the local-part has no usable chars', () => {
  const owner = buildOrgName('---@example.com', 'fallback-id');
  assert.match(owner, /^user-[a-f0-9]{4}$/);
});
