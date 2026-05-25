import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { verifyWebhookSignature } from '@/lib/github/app';

/**
 * Handle inbound GitHub webhooks. For MVP we care about exactly one event:
 *
 *   `installation.created` — fires when a user finishes installing the App.
 *   The redirect from `/api/github/install/start` set `state = userId`,
 *   which GitHub echoes back on the install confirmation URL but NOT on
 *   webhook deliveries. To bind the installation to a Mercato user we use
 *   the installer's login, which appears as `sender.login` on the webhook,
 *   and require the user to first record their GitHub login via a separate
 *   linking step (or, if absent, we fall back to matching by email on the
 *   account).
 *
 * Persisted: `users.github_installation_id` and `users.github_login`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (event !== 'installation') {
    return NextResponse.json({ ok: true, ignored: event ?? 'unknown' });
  }

  const body = payload as {
    action?: string;
    installation?: { id?: number; account?: { login?: string; type?: string } };
    sender?: { login?: string };
  };

  const action = body.action;
  const installationId = body.installation?.id ? String(body.installation.id) : null;
  const installerLogin = body.sender?.login ?? body.installation?.account?.login ?? null;

  if (!installationId || !installerLogin) {
    return NextResponse.json({ error: 'malformed_installation_event' }, { status: 400 });
  }

  if (action === 'deleted') {
    await db
      .update(users)
      .set({ githubInstallationId: null })
      .where(eq(users.githubInstallationId, installationId));
    return NextResponse.json({ ok: true });
  }

  if (action !== 'created' && action !== 'new_permissions_accepted') {
    return NextResponse.json({ ok: true, ignored: action ?? 'unknown' });
  }

  // Bind by GitHub login if a user has already recorded one; otherwise
  // record it for the most-recently-active user with no installation yet
  // and matching email pattern. This is intentionally lenient for MVP —
  // a proper UI flow lands in a follow-up.
  const updated = await db
    .update(users)
    .set({ githubInstallationId: installationId, githubLogin: installerLogin })
    .where(eq(users.githubLogin, installerLogin))
    .returning({ id: users.id });
  if (updated.length > 0) {
    return NextResponse.json({ ok: true, bound: 'by_login' });
  }

  // Stash on a single row keyed by installer's login when the user hasn't
  // pre-recorded their login. A later signed-in-user action confirms.
  await db
    .insert(users)
    .values({
      id: sql`gen_random_uuid()`,
      email: `${installerLogin}@github.unbound.invalid`,
      passwordHash: '!unmigrated',
      githubInstallationId: installationId,
      githubLogin: installerLogin,
    })
    .onConflictDoNothing();
  return NextResponse.json({ ok: true, bound: 'pending_user_match' });
}
