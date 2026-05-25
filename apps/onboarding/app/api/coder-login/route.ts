import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { requireSessionFromRequest } from '@/lib/auth';
import { coderFetch } from '@/lib/coder';
import { db } from '@/lib/db';
import { users } from '@/db/schema';

/**
 * GET /api/coder-login?sandbox_id=<id>&next=<url>
 *
 * Mints a short-lived Coder API token for the sandbox owner, sets it as
 * `coder_session_token` cookie scoped to the wildcard domain (e.g.
 * `.sandbox.lvh.me`) so the browser is silently logged in to Coder, then
 * redirects to `next`.
 *
 * This gives "one-click" VS Code / Terminal / Coder dashboard access without
 * showing the Coder login form.
 */

interface KeyResponse {
  key: string;
}

// 8 hours — long enough for a dev session, short enough to not be a concern.
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;

export async function GET(req: Request): Promise<NextResponse> {
  // 1. Require onboarding session.
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }

  const { searchParams } = new URL(req.url);
  const next = searchParams.get('next') || '/';

  // 2. Validate `next` is a safe URL (same-origin or known Coder domain).
  //    We allow any http/https URL for Coder, but guard against javascript: etc.
  let nextUrl: URL;
  try {
    nextUrl = new URL(next);
    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Invalid next URL' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid next URL' }, { status: 400 });
  }

  // 3. Look up the Coder user id for the logged-in onboarding user.
  //    We allow any sandbox_id to be passed but only use it for rate-limiting
  //    context — the token is always minted for the owner of the session.
  const [user] = await db
    .select({ coderUserId: users.coderUserId })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);
  if (!user?.coderUserId) {
    // User exists but has no Coder account yet — just redirect without cookie.
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  // 4. Mint a Coder API key for the workspace user via admin API.
  let coderKey: string;
  try {
    const keyResp = await coderFetch<KeyResponse>(
      `/api/v2/users/${user.coderUserId}/keys`,
      {
        method: 'POST',
        body: JSON.stringify({ lifetime: TOKEN_LIFETIME_SECONDS }),
      },
    );
    coderKey = keyResp.key;
  } catch (e) {
    // Fallback: redirect without cookie so at least the page loads (Coder will
    // show its own login form rather than breaking entirely).
    console.error('[coder-login] failed to mint Coder key:', e);
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  // 5. Set coder_session_token cookie scoped to the shared wildcard domain.
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  const response = NextResponse.redirect(nextUrl.toString(), 302);

  // Clear stale parent-domain tokens before setting a fresh one. Browser
  // requests can otherwise carry multiple coder_session_token values, and the
  // Coder websocket endpoints may authenticate against the wrong token.
  const clearOptions = {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 0,
  };
  response.cookies.set('coder_session_token', '', clearOptions);
  if (cookieDomain) {
    response.cookies.set('coder_session_token', '', {
      ...clearOptions,
      domain: cookieDomain,
    });
  }

  response.cookies.set('coder_session_token', coderKey, {
    httpOnly: false, // Coder's JS reads this cookie; must NOT be httpOnly.
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: TOKEN_LIFETIME_SECONDS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return response;
}
