import { NextResponse } from 'next/server';

import { requireSessionFromRequest } from '@/lib/auth';
import { OmBillingError, startSubscriptionPortal } from '@/lib/om-billing';
import { resolvePublicBaseUrl } from '@/lib/public-url';

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (response) {
    if (response instanceof NextResponse) return response;
    throw response;
  }

  try {
    const result = await startSubscriptionPortal({
      userId: session.sub,
      baseUrl: resolvePublicBaseUrl(req),
    });
    return NextResponse.json({ portal_url: result.portalUrl }, { status: 201 });
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
