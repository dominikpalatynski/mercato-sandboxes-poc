export type PublicUrlEnv = Readonly<Record<string, string | undefined>>;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

function normalizePublicOrigin(raw: string): string {
  const url = new URL(raw);
  return url.origin;
}

export function resolvePublicBaseUrl(
  req: Request,
  env: PublicUrlEnv = process.env as PublicUrlEnv,
): string {
  const configured =
    env.ONBOARDING_PUBLIC_URL
    ?? env.PUBLIC_APP_URL
    ?? env.APP_URL
    ?? env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return normalizePublicOrigin(configured);
  }

  const forwardedHost = firstHeaderValue(req.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(req.headers.get('x-forwarded-proto'));
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`;
  }

  const host = firstHeaderValue(req.headers.get('host'));
  if (host) {
    const requestUrl = new URL(req.url);
    return `${requestUrl.protocol.replace(/:$/, '')}://${host}`;
  }

  return new URL(req.url).origin;
}
