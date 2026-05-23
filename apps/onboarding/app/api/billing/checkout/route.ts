import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSessionFromRequest } from '@/lib/auth';
import { OmBillingError, startSubscriptionCheckout } from '@/lib/om-billing';

const Body = z.object({
  price_code: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (response) {
    if (response instanceof NextResponse) return response;
    throw response;
  }

  let payload: unknown = {};
  if (req.headers.get('content-length') !== '0') {
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid checkout payload' },
      { status: 400 },
    );
  }

  try {
    const result = await startSubscriptionCheckout({
      userId: session.sub,
      baseUrl: req.url,
      priceCode: parsed.data.price_code,
    });
    return NextResponse.json(
      {
        checkout_url: result.checkoutUrl,
        subscription_request_id: result.subscriptionRequestId,
        price_code: result.priceCode,
        product_code: result.productCode,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OmBillingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
