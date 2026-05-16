import { createHash } from 'node:crypto';

import { BILLING_ERROR_CODES } from '@/lib/billing-types';

const DEFAULT_API_BASE_URL = 'https://secure.paybylink.pl/api/v1';
export const PAYBYLINK_WEBHOOK_OK_BODY = 'OK';

export interface CreatePayByLinkCheckoutInput {
  orderId: string;
  email: string;
  amountPln: number;
  description: string;
  notifyUrl: string;
  returnUrlSuccess: string;
}

export interface PayByLinkCheckoutSession {
  providerOrderId: string;
  paymentUrl: string;
}

export interface PayByLinkWebhookEvent {
  provider: 'paybylink';
  providerEventId: string;
  providerOrderId: string;
  localOrderId: string | null;
  amountPln: number;
  email: string | null;
  paymentType: string | null;
  notificationAttempt: number;
  rawPayload: Record<string, unknown>;
}

export class PayByLinkError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PayByLinkError';
  }
}

function apiBaseUrl(): string {
  return (process.env.PAYBYLINK_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

function shopId(): number {
  const raw = process.env.PAYBYLINK_SHOP_ID;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new PayByLinkError(
      500,
      BILLING_ERROR_CODES.PROVIDER_CONFIGURATION_MISSING,
      'PAYBYLINK_SHOP_ID is not configured',
    );
  }
  return parsed;
}

function privateKey(): string {
  const key = process.env.PAYBYLINK_PRIVATE_KEY;
  if (!key) {
    throw new PayByLinkError(
      500,
      BILLING_ERROR_CODES.PROVIDER_CONFIGURATION_MISSING,
      'PAYBYLINK_PRIVATE_KEY is not configured',
    );
  }
  return key;
}

function signatureAlgorithm(): string {
  return (process.env.PAYBYLINK_SIGNATURE_ALGORITHM || 'sha256').toLowerCase();
}

function hashSignature(input: string): string {
  return createHash(signatureAlgorithm()).update(input, 'utf8').digest('hex');
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

export function buildPayByLinkCheckoutSignature(input: {
  shopId: number;
  amountPln: number;
  control: string;
  description: string;
  email: string;
  notifyUrl: string;
  returnUrlSuccess: string;
}): string {
  return hashSignature(
    [
      privateKey(),
      String(input.shopId),
      formatAmount(input.amountPln),
      input.control,
      input.description,
      input.email,
      input.notifyUrl,
      input.returnUrlSuccess,
    ].join('|'),
  );
}

export function buildPayByLinkWebhookSignature(input: {
  transactionId: string;
  control: string;
  email: string;
  amountPaid: number;
  notificationAttempt: number;
  paymentType: string;
  apiVersion: number;
}): string {
  return hashSignature(
    [
      privateKey(),
      input.transactionId,
      input.control,
      input.email,
      formatAmount(input.amountPaid),
      String(input.notificationAttempt),
      input.paymentType,
      String(input.apiVersion),
    ].join('|'),
  );
}

async function payByLinkFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.errorCode === 'number') {
    const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new PayByLinkError(res.status || 502, 'paybylink_checkout_failed', message);
  }

  return data as T;
}

export async function createPayByLinkCheckoutSession(
  input: CreatePayByLinkCheckoutInput,
): Promise<PayByLinkCheckoutSession> {
  const payload = {
    shopId: shopId(),
    price: Number(formatAmount(input.amountPln)),
    control: input.orderId,
    description: input.description,
    email: input.email,
    notifyURL: input.notifyUrl,
    returnUrlSuccess: input.returnUrlSuccess,
    signature: buildPayByLinkCheckoutSignature({
      shopId: shopId(),
      amountPln: input.amountPln,
      control: input.orderId,
      description: input.description,
      email: input.email,
      notifyUrl: input.notifyUrl,
      returnUrlSuccess: input.returnUrlSuccess,
    }),
  };

  const response = await payByLinkFetch<{ url?: unknown; transactionId?: unknown }>(
    '/transfer/generate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const paymentUrl = typeof response.url === 'string' ? response.url : '';
  const providerOrderId = typeof response.transactionId === 'string' ? response.transactionId : '';

  if (!paymentUrl || !providerOrderId) {
    throw new PayByLinkError(502, 'paybylink_checkout_failed', 'Invalid PayByLink response');
  }

  return { providerOrderId, paymentUrl };
}

export function verifyPayByLinkWebhook(rawBody: string): PayByLinkWebhookEvent {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new PayByLinkError(400, 'invalid_json', 'Invalid PayByLink webhook body');
  }

  const transactionId = String(payload.transactionId || '');
  const control = typeof payload.control === 'string' ? payload.control : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const amountPaid = Number(payload.amountPaid);
  const notificationAttempt = Number(payload.notificationAttempt);
  const paymentType = typeof payload.paymentType === 'string' ? payload.paymentType : '';
  const apiVersion = Number(payload.apiVersion || 1);
  const signature = typeof payload.signature === 'string' ? payload.signature : '';

  if (!transactionId || !Number.isFinite(amountPaid) || !Number.isFinite(notificationAttempt) || !signature) {
    throw new PayByLinkError(400, 'invalid_payload', 'Missing required PayByLink webhook fields');
  }

  const expectedSignature = buildPayByLinkWebhookSignature({
    transactionId,
    control,
    email,
    amountPaid,
    notificationAttempt,
    paymentType,
    apiVersion,
  });

  if (signature !== expectedSignature) {
    throw new PayByLinkError(
      400,
      BILLING_ERROR_CODES.INVALID_WEBHOOK_SIGNATURE,
      'Invalid PayByLink webhook signature',
    );
  }

  return {
    provider: 'paybylink',
    providerEventId: `${transactionId}:${notificationAttempt}`,
    providerOrderId: transactionId,
    localOrderId: control || null,
    amountPln: Number(formatAmount(amountPaid)),
    email: email || null,
    paymentType: paymentType || null,
    notificationAttempt,
    rawPayload: payload,
  };
}
