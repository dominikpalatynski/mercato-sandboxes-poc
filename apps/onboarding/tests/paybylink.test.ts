import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPayByLinkWebhookSignature,
  verifyPayByLinkWebhook,
} from '../lib/paybylink';

test('verifyPayByLinkWebhook accepts a valid signed payload', () => {
  process.env.PAYBYLINK_PRIVATE_KEY = 'test-private-key';

  const payload = {
    transactionId: 'tx-123',
    control: 'order-123',
    email: 'user@example.com',
    amountPaid: 99.5,
    notificationAttempt: 1,
    paymentType: 'transfer',
    apiVersion: 1,
  };

  const signature = buildPayByLinkWebhookSignature(payload);
  const event = verifyPayByLinkWebhook(JSON.stringify({ ...payload, signature }));

  assert.equal(event.provider, 'paybylink');
  assert.equal(event.providerEventId, 'tx-123:1');
  assert.equal(event.providerOrderId, 'tx-123');
  assert.equal(event.localOrderId, 'order-123');
  assert.equal(event.amountPln, 99.5);
  assert.equal(event.email, 'user@example.com');
});

test('verifyPayByLinkWebhook rejects an invalid signature', () => {
  process.env.PAYBYLINK_PRIVATE_KEY = 'test-private-key';

  assert.throws(
    () =>
      verifyPayByLinkWebhook(
        JSON.stringify({
          transactionId: 'tx-123',
          control: 'order-123',
          email: 'user@example.com',
          amountPaid: 99.5,
          notificationAttempt: 1,
          paymentType: 'transfer',
          apiVersion: 1,
          signature: 'wrong',
        }),
      ),
    /Invalid PayByLink webhook signature/,
  );
});
