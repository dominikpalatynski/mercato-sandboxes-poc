import assert from 'node:assert/strict';
import test from 'node:test';

import { orgNameForUser } from '../lib/gitea/client';

test('orgNameForUser strips UUID hyphens to satisfy Gitea owner length limits', () => {
  const owner = orgNameForUser('02c2f38f-241a-4d4d-a4d1-817d1566480c');
  assert.equal(owner, 'user-02c2f38f241a4d4da4d1817d1566480c');
  assert.ok(owner.length <= 40);
});

test('orgNameForUser normalizes arbitrary ids to a stable Gitea owner name', () => {
  const owner = orgNameForUser('USER_1234---with symbols and a very long suffix');
  assert.match(owner, /^user-[a-z0-9]+$/);
  assert.ok(owner.length <= 40);
});
