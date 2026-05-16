import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(req: Request): Promise<NextResponse> {
  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto');
  const url = fwdHost
    ? new URL('/login', `${fwdProto ?? 'http'}://${fwdHost}`)
    : new URL('/login', req.url);
  const res = NextResponse.redirect(url, { status: 303 });
  clearSessionCookie(res);
  return res;
}
