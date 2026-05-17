import assert from 'node:assert/strict';
import test from 'node:test';

import { APP_SECTION_NAV_ITEMS, isAppSectionActive } from '../lib/app-sections';

test('authenticated navigation exposes dashboard and billing sections', () => {
  assert.deepEqual(APP_SECTION_NAV_ITEMS, [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/billing', label: 'Billing' },
  ]);
});

test('isAppSectionActive matches the current section path', () => {
  assert.equal(isAppSectionActive('/dashboard', '/dashboard'), true);
  assert.equal(isAppSectionActive('/dashboard', '/billing'), false);
  assert.equal(isAppSectionActive('/billing', '/billing'), true);
  assert.equal(isAppSectionActive('/billing/history', '/billing'), true);
  assert.equal(isAppSectionActive('/billing-history', '/billing'), false);
  assert.equal(isAppSectionActive(null, '/billing'), false);
});
