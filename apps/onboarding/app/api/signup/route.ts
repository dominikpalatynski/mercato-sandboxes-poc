import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { hashPassword, signSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
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
  const password = parsed.data.password;

  const existing = await query<{ id: string }>('select id from users where email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const inserted = await query<{ id: string; email: string }>(
    'insert into users (email, password_hash) values ($1, $2) returning id, email',
    [email, password_hash],
  );
  const user = inserted.rows[0];
  if (!user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  const token = await signSession({ sub: user.id, email: user.email });
  const res = NextResponse.json({ ok: true, redirect: '/dashboard' }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
