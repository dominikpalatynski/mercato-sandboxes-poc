import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload extends JWTPayload {
  sub: string;       // user id
  email: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET is not set or is too short');
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(payload: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return { sub: payload.sub, email: payload.email, ...payload };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

/**
 * Request-aware session check for route handlers. Throws a NextResponse
 * (401 JSON) when no/invalid session — handlers should:
 *   try { const s = await requireSessionFromRequest(req); ... }
 *   catch (resp) { if (resp instanceof NextResponse) return resp; throw resp; }
 */
export async function requireSessionFromRequest(req: Request): Promise<SessionPayload> {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : '';
  if (!token) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const session = await verifySession(token);
  if (!session) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return session;
}

export function sessionCookieOptions() {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    ...(domain ? { domain } : {}),
  };
}
