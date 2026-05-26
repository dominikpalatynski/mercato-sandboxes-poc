import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { requireSessionFromRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { giteaPublicUrl, passwordForOwner, setOwnerPassword } from '@/lib/gitea/client';

/**
 * GET /api/gitea-login?next=<gitea-url>
 *
 * Silently signs the onboarding session user into Gitea as the owner of their
 * backing Gitea account (which is also their per-user "org"), then redirects
 * to `next`. Mirrors the Coder bridge in /api/coder-login.
 *
 * How it works:
 *   1. Look up the user's Gitea username (= org name) on `users.giteaOrgName`.
 *   2. PATCH the backing user's password to the deterministic value so the
 *      web login form accepts it (the password may have been rotated by a
 *      previous deploy-token mint).
 *   3. GET Gitea's `/user/login` to acquire a fresh `_csrf` cookie and form
 *      token.
 *   4. POST `/user/login` with the captured `_csrf` plus `user_name` /
 *      `password` form fields. Gitea responds with a Set-Cookie containing
 *      `i_like_gitea` — that's the session.
 *   5. Forward the `i_like_gitea` (and `_csrf`) cookies to the user's browser,
 *      scoped to the shared parent domain via `COOKIE_DOMAIN`, then redirect
 *      to `next`.
 *
 * If anything fails along the way, redirect to `next` without setting cookies
 * so the user lands on Gitea's regular login form (and can fall back to the
 * credentials shown on the sandbox detail page).
 */

const GITEA_SESSION_COOKIE = 'i_like_gitea';
const GITEA_CSRF_COOKIE = '_csrf';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function parseSetCookies(setCookies: string[]): Map<string, { value: string; attrs: string }> {
  const out = new Map<string, { value: string; attrs: string }>();
  for (const raw of setCookies) {
    const [pair, ...rest] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    out.set(name, { value, attrs: rest.join(';') });
  }
  return out;
}

function getSetCookieList(headers: Headers): string[] {
  // Node 19.7+ / Next.js exposes getSetCookie() on the Headers prototype.
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  // Fallback: a single combined header.
  const combined = headers.get('set-cookie');
  return combined ? [combined] : [];
}

function isHttpOnly(attrs: string): boolean {
  return /;\s*HttpOnly/i.test(`;${attrs}`);
}

function isSecure(attrs: string): boolean {
  return /;\s*Secure/i.test(`;${attrs}`);
}

export async function GET(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }

  const { searchParams } = new URL(req.url);
  const requestedNext = searchParams.get('next') || giteaPublicUrl;

  const giteaOrigin = new URL(giteaPublicUrl).origin;

  // Validate `next`: must be an HTTP(S) URL on the configured Gitea origin.
  let nextUrl: URL;
  try {
    nextUrl = new URL(requestedNext);
  } catch {
    return NextResponse.json({ error: 'Invalid next URL' }, { status: 400 });
  }
  if (nextUrl.origin !== giteaOrigin) {
    return NextResponse.json({ error: 'next must point at Gitea' }, { status: 400 });
  }

  const [user] = await db
    .select({ giteaOrgName: users.giteaOrgName })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);
  if (!user?.giteaOrgName) {
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  const orgName = user.giteaOrgName;

  // Make sure the backing Gitea user has the deterministic password active.
  // setOwnerPassword is idempotent (it PATCHes the user).
  let password: string;
  try {
    password = await setOwnerPassword(orgName);
  } catch (e) {
    console.error('[gitea-login] failed to reset Gitea password:', e);
    password = passwordForOwner(orgName);
  }

  // 1. GET /user/login to seed the CSRF cookie.
  let csrfValue = '';
  let csrfCookieFromGitea = '';
  try {
    const seed = await fetch(`${giteaOrigin}/user/login`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
    });
    const cookies = parseSetCookies(getSetCookieList(seed.headers));
    const csrf = cookies.get(GITEA_CSRF_COOKIE);
    if (csrf) {
      csrfValue = csrf.value;
      csrfCookieFromGitea = `${GITEA_CSRF_COOKIE}=${csrf.value}`;
    }
  } catch (e) {
    console.error('[gitea-login] failed to seed CSRF cookie:', e);
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  if (!csrfValue) {
    console.error('[gitea-login] gitea did not set a CSRF cookie on /user/login');
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  // 2. POST /user/login with the captured _csrf as both a cookie and a form
  //    field. Gitea verifies they match before honoring the credentials.
  const body = new URLSearchParams();
  body.set('_csrf', csrfValue);
  body.set('user_name', orgName);
  body.set('password', password);
  body.set('remember', 'on');

  let loginCookies: Map<string, { value: string; attrs: string }>;
  try {
    const loginRes = await fetch(`${giteaOrigin}/user/login`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: csrfCookieFromGitea,
        // Gitea checks Referer for login CSRF defense-in-depth.
        Referer: `${giteaOrigin}/user/login`,
      },
      redirect: 'manual',
      cache: 'no-store',
    });
    loginCookies = parseSetCookies(getSetCookieList(loginRes.headers));
  } catch (e) {
    console.error('[gitea-login] failed to POST /user/login:', e);
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  const sessionCookie = loginCookies.get(GITEA_SESSION_COOKIE);
  if (!sessionCookie || !sessionCookie.value) {
    console.error('[gitea-login] login did not return a session cookie for', orgName);
    return NextResponse.redirect(nextUrl.toString(), 302);
  }

  // 3. Forward the session (and rotated CSRF) cookies to the user's browser.
  const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;
  const cookieSecure = process.env.COOKIE_SECURE === 'true';
  const response = NextResponse.redirect(nextUrl.toString(), 302);

  response.cookies.set(GITEA_SESSION_COOKIE, sessionCookie.value, {
    httpOnly: isHttpOnly(sessionCookie.attrs) || true,
    sameSite: 'lax',
    secure: cookieSecure || isSecure(sessionCookie.attrs),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  const rotatedCsrf = loginCookies.get(GITEA_CSRF_COOKIE);
  if (rotatedCsrf?.value) {
    response.cookies.set(GITEA_CSRF_COOKIE, rotatedCsrf.value, {
      httpOnly: false,
      sameSite: 'lax',
      secure: cookieSecure || isSecure(rotatedCsrf.attrs),
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
  }

  return response;
}
