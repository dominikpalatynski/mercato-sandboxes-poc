import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import {
  verifyPassword,
  signSession,
  sessionCookieOptions,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase().trim();

  const result = await query<{ id: string; email: string; password_hash: string }>(
    'select id, email, password_hash from users where email = $1',
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signSession({ sub: user.id, email: user.email });
  const res = NextResponse.json({ ok: true, redirect: '/dashboard' }, { status: 200 });
  clearSessionCookie(res);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
