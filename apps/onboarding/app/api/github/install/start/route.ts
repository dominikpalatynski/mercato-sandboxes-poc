import { NextResponse } from 'next/server';
import { requireSessionFromRequest } from '@/lib/auth';
import { appInstallUrl } from '@/lib/github/app';

/**
 * Kick off the GitHub App install flow by redirecting to the App's public
 * install page. After the user picks a target account / org, GitHub
 * redirects back to the App's configured callback (handled by the webhook
 * `installation` event — see `/api/github/webhook`).
 *
 * The `state` query string is the Mercato user ID so the webhook can
 * persist `installation_id` against the right row.
 */
export async function GET(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }

  const url = new URL(appInstallUrl());
  url.searchParams.set('state', session.sub);
  return NextResponse.redirect(url.toString());
}
