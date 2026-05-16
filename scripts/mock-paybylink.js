#!/usr/bin/env node

const http = require('node:http');
const { randomUUID } = require('node:crypto');

const host = process.env.PAYBYLINK_MOCK_HOST || '127.0.0.1';
const port = Number(process.env.PAYBYLINK_MOCK_PORT || '9999');
const publicBaseUrl = process.env.PAYBYLINK_MOCK_PUBLIC_BASE_URL || `http://${host}:${port}`;
const transactionPrefix = process.env.PAYBYLINK_MOCK_TRANSACTION_PREFIX || 'pbl-mock';
const checkoutUrlTemplate =
  process.env.PAYBYLINK_MOCK_CHECKOUT_URL || 'https://fake-pay.test/checkout/{transactionId}';

if (!Number.isFinite(port) || port <= 0) {
  console.error(`[mock-paybylink] invalid PAYBYLINK_MOCK_PORT: ${process.env.PAYBYLINK_MOCK_PORT}`);
  process.exit(1);
}

let requestCount = 0;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFragment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function buildTransactionId(control) {
  const controlFragment = sanitizeFragment(control);
  if (controlFragment) {
    return `${transactionPrefix}-${controlFragment}`;
  }
  return `${transactionPrefix}-${randomUUID()}`;
}

function buildCheckoutUrl(transactionId) {
  return checkoutUrlTemplate.replace('{transactionId}', encodeURIComponent(transactionId));
}

function printStartupNotes() {
  console.log(`[mock-paybylink] listening on ${publicBaseUrl}`);
  console.log('[mock-paybylink] handles POST /api/v1/transfer/generate');
  console.log('[mock-paybylink] set these env vars for apps/onboarding:');
  console.log(`  PAYBYLINK_API_BASE_URL=${publicBaseUrl}/api/v1`);
  console.log('  PAYBYLINK_SHOP_ID=123');
  console.log('  PAYBYLINK_PRIVATE_KEY=test-private-key');
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', publicBaseUrl);

  if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, service: 'mock-paybylink' });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/v1/transfer/generate') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { errorCode: 400, error: 'Invalid JSON' });
      return;
    }

    requestCount += 1;
    const transactionId =
      typeof payload.transactionId === 'string' && payload.transactionId.trim().length > 0
        ? payload.transactionId.trim()
        : buildTransactionId(payload.control);
    const paymentUrl = buildCheckoutUrl(transactionId);

    console.log(
      `[mock-paybylink] #${requestCount} generated checkout: control=${payload.control || ''} price=${payload.price || ''} email=${payload.email || ''} transactionId=${transactionId}`,
    );

    sendJson(res, 200, {
      url: paymentUrl,
      transactionId,
      mock: true,
    });
    return;
  }

  sendJson(res, 404, {
    errorCode: 404,
    error: `No mock handler for ${req.method} ${requestUrl.pathname}`,
  });
});

server.listen(port, host, () => {
  printStartupNotes();
});

server.on('error', (error) => {
  console.error('[mock-paybylink] server error:', error);
  process.exitCode = 1;
});
