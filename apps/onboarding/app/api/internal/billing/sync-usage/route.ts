import { NextResponse } from 'next/server';

import {
  BillingError,
  syncActiveBillingUsage,
  verifyInternalBillingSyncRequest,
} from '@/lib/billing';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    verifyInternalBillingSyncRequest(req);
    const result = await syncActiveBillingUsage();
    return NextResponse.json(result);
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
