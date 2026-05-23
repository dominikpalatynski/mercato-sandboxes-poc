import { NextResponse } from 'next/server';

import {
  OM_WEBHOOK_EVENT_ID_HEADER,
  OM_WEBHOOK_SIGNATURE_HEADER,
  OmBillingError,
  processOmAccessChangedWebhook,
} from '@/lib/om-billing';

export async function POST(req: Request): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const signature = req.headers.get(OM_WEBHOOK_SIGNATURE_HEADER);
  const deliveryId = req.headers.get(OM_WEBHOOK_EVENT_ID_HEADER);

  try {
    const result = await processOmAccessChangedWebhook({
      rawBody,
      signature,
      deliveryId,
    });
    return NextResponse.json({
      ok: true,
      already_processed: result.already_processed,
      user_id: result.user_id,
      access_state: result.access_state,
    });
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
