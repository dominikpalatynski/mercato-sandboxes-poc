import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { users } from '@/db/schema';
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

  const [user] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await signSession({ sub: user.id, email: user.email });
  const res = NextResponse.json({ ok: true, redirect: '/dashboard' }, { status: 200 });
  clearSessionCookie(res);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
