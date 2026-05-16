import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import {
  hashPassword,
  signSession,
  sessionCookieOptions,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  company_name: z.string().trim().max(120).optional().or(z.literal('')),
  accept_terms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service' }),
  }),
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
    const first = parsed.error.errors[0];
    return NextResponse.json(
      { error: first?.message ?? 'Invalid signup payload' },
      { status: 400 },
    );
  }
  const email = parsed.data.email.toLowerCase().trim();
  const password = parsed.data.password;
  const first_name = parsed.data.first_name;
  const last_name = parsed.data.last_name;
  const company_name = parsed.data.company_name?.trim() || null;

  const existing = await query<{ id: string }>('select id from users where email = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const inserted = await query<{ id: string; email: string }>(
    `insert into users (email, password_hash, first_name, last_name, company_name, accepted_terms_at)
     values ($1, $2, $3, $4, $5, now())
     returning id, email`,
    [email, password_hash, first_name, last_name, company_name],
  );
  const user = inserted.rows[0];
  if (!user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  const token = await signSession({ sub: user.id, email: user.email });
  const res = NextResponse.json({ ok: true, redirect: '/dashboard' }, { status: 201 });
  clearSessionCookie(res);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
