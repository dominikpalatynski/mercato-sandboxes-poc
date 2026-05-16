import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSessionFromRequest } from '@/lib/auth';
import { createBillingCheckout, BillingError } from '@/lib/billing';
import { BILLING_PLAN_TYPES } from '@/lib/billing-types';

const Body = z.object({
  plan_type: z.enum(BILLING_PLAN_TYPES),
  credits_usd: z.number().positive().finite(),
});

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (response) {
    if (response instanceof NextResponse) return response;
    throw response;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid checkout payload' },
      { status: 400 },
    );
  }

  try {
    const result = await createBillingCheckout({
      userId: session.sub,
      planType: parsed.data.plan_type,
      creditsUsd: parsed.data.credits_usd,
      baseUrl: req.url,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
}
