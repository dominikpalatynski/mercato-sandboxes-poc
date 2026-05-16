import { NextResponse } from 'next/server';

import { BillingError, processPayByLinkPaymentWebhook } from '@/lib/billing';
import {
  PAYBYLINK_WEBHOOK_OK_BODY,
  PayByLinkError,
} from '@/lib/paybylink';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  try {
    await processPayByLinkPaymentWebhook(rawBody);
    return new Response(PAYBYLINK_WEBHOOK_OK_BODY, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    if (error instanceof BillingError || error instanceof PayByLinkError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
