import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicBaseUrl } from '../lib/public-url';

test('resolvePublicBaseUrl prefers configured onboarding public URL', () => {
  const req = new Request('http://0.0.0.0:3000/api/billing/checkout', {
    headers: {
      'x-forwarded-host': 'wrong.example',
      'x-forwarded-proto': 'http',
    },
  });

  assert.equal(
    resolvePublicBaseUrl(req, { ONBOARDING_PUBLIC_URL: 'https://sandbox.example.com/' }),
    'https://sandbox.example.com',
  );
});

test('resolvePublicBaseUrl uses forwarded proxy headers when no public URL is configured', () => {
  const req = new Request('http://0.0.0.0:3000/api/billing/checkout', {
    headers: {
      'x-forwarded-host': 'sandbox.example.com',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(resolvePublicBaseUrl(req, {}), 'https://sandbox.example.com');
});
