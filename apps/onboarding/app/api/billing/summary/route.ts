import { NextResponse } from 'next/server';

import { requireSessionFromRequest } from '@/lib/auth';
import { getBillingSummaryForUser } from '@/lib/billing';

export async function GET(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (response) {
    if (response instanceof NextResponse) return response;
    throw response;
  }

  const summary = await getBillingSummaryForUser(session.sub);
  return NextResponse.json(summary);
}
