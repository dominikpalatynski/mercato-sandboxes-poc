import { NextResponse } from 'next/server';

import {
  OmBillingError,
  syncActiveOmBillingUsage,
  verifyInternalBillingSyncRequest,
} from '@/lib/om-billing';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    verifyInternalBillingSyncRequest(req);
    const result = await syncActiveOmBillingUsage();
    return NextResponse.json(result);
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
