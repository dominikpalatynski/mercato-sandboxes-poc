import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  sessionCookieOptions,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth';
import { SignupError, registerUser } from '@/lib/signup';

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
  try {
    const result = await registerUser({
      email: parsed.data.email,
      password: parsed.data.password,
      firstName: parsed.data.first_name,
      lastName: parsed.data.last_name,
      companyName: parsed.data.company_name?.trim() || null,
    });

    const res = NextResponse.json({ ok: true, redirect: '/dashboard' }, { status: 201 });
    clearSessionCookie(res);
    res.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
