#!/usr/bin/env node

import { createHash } from 'node:crypto';

const DEFAULT_EMAIL = 'superadmin@acme.com';
const DEFAULT_AMOUNT_PLN = 200;
const DEFAULT_ATTEMPT = 1;
const DEFAULT_PAYMENT_TYPE = 'transfer';
const DEFAULT_API_VERSION = 1;
const DEFAULT_TRANSACTION_PREFIX = process.env.PAYBYLINK_MOCK_TRANSACTION_PREFIX || 'pbl-mock';
const DEFAULT_WEBHOOK_URL =
  process.env.PAYBYLINK_WEBHOOK_URL || 'http://sandbox.lvh.me:3000/api/billing/paybylink/webhook';

function usage() {
  console.error(
    'Usage: PAYBYLINK_PRIVATE_KEY=test-private-key node scripts/mock-paybylink-webhook.mjs <transaction-id>',
  );
}

function getPrivateKey() {
  return process.env.PAYBYLINK_PRIVATE_KEY || 'test-private-key';
}

function deriveControl(transactionId) {
  const prefix = `${DEFAULT_TRANSACTION_PREFIX}-`;
  if (transactionId.startsWith(prefix) && transactionId.length > prefix.length) {
    return transactionId.slice(prefix.length);
  }
  return transactionId;
}

function buildSignature({
  privateKey,
  transactionId,
  control,
  email,
  amountPaid,
  notificationAttempt,
  paymentType,
  apiVersion,
}) {
  const input = [
    privateKey,
    transactionId,
    control,
    email,
    Number(amountPaid).toFixed(2),
    String(Number(notificationAttempt)),
    paymentType,
    String(Number(apiVersion)),
  ].join('|');

  return createHash(process.env.PAYBYLINK_SIGNATURE_ALGORITHM || 'sha256')
    .update(input, 'utf8')
    .digest('hex');
}

async function main() {
  const transactionId = process.argv[2]?.trim();

  if (!transactionId) {
    usage();
    process.exit(1);
  }

  const payload = {
    transactionId,
    control: process.env.PAYBYLINK_WEBHOOK_CONTROL || deriveControl(transactionId),
    email: DEFAULT_EMAIL,
    amountPaid: DEFAULT_AMOUNT_PLN,
    notificationAttempt: DEFAULT_ATTEMPT,
    paymentType: DEFAULT_PAYMENT_TYPE,
    apiVersion: DEFAULT_API_VERSION,
  };

  payload.signature = buildSignature({
    privateKey: getPrivateKey(),
    ...payload,
  });

  const response = await fetch(DEFAULT_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`[mock-paybylink-webhook] request failed: ${response.status} ${response.statusText}`);
    console.error(responseText);
    process.exit(1);
  }

  console.log(responseText);
}

main().catch((error) => {
  console.error('[mock-paybylink-webhook] unexpected error:', error);
  process.exit(1);
});
