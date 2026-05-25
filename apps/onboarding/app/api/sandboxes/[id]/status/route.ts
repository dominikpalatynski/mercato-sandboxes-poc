import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes, users } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { buildLinks, coderPublicUrl, getWorkspaceStatus, resolveAppUrl } from '@/lib/coder';
import { toApiSandbox } from '@/lib/api-mappers';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }
  const { id } = await ctx.params;

  const [sandbox] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, id), eq(sandboxes.userId, session.sub)))
    .limit(1);
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [userRow] = await db
    .select({
      githubLogin: users.githubLogin,
      githubInstallationId: users.githubInstallationId,
    })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);
  const githubLink = {
    github_login: userRow?.githubLogin ?? null,
    github_installation_id: userRow?.githubInstallationId ?? null,
  };

  if (sandbox.status === 'failed') {
    return NextResponse.json({ ...toApiSandbox(sandbox), ...githubLink });
  }

  if (!sandbox.coderWorkspaceId) {
    return NextResponse.json({ ...toApiSandbox(sandbox), ...githubLink });
  }

  let cs;
  try {
    cs = await getWorkspaceStatus(sandbox.coderWorkspaceId);
  } catch (e) {
    return NextResponse.json({
      ...toApiSandbox(sandbox),
      ...githubLink,
      status_message: `Polling Coder failed: ${String(e).slice(0, 200)}`,
    });
  }

  let newStatus = sandbox.status;
  let newMessage = sandbox.statusMessage ?? '';
  let newVscode = sandbox.vscodeUrl;
  let newTerminal = sandbox.terminalUrl;
  let newApp = sandbox.appUrl;
  let newSplash = sandbox.splashUrl;
  const hasPublishedLinks = Boolean(
    sandbox.vscodeUrl || sandbox.terminalUrl || sandbox.appUrl || sandbox.splashUrl,
  );

  const lifecycleReady =
    cs.lifecycleState === 'ready' ||
    cs.lifecycleState === 'start_timeout' ||
    cs.lifecycleState === 'start_error';

  if (cs.transition === 'stop') {
    if (cs.jobStatus === 'succeeded') {
      newStatus = 'stopped';
      newMessage = 'Workspace paused';
    } else if (cs.jobStatus === 'failed' || cs.jobStatus === 'canceled') {
      newStatus = 'ready';
      newMessage = `Workspace stop ${cs.jobStatus}; workspace still running`;
    } else {
      newStatus = 'building';
      newMessage = 'Stopping workspace…';
    }
  } else if (cs.jobStatus === 'failed' || cs.jobStatus === 'canceled') {
    if (cs.transition === 'start' && hasPublishedLinks) {
      newStatus = 'stopped';
      newMessage = `Workspace failed to resume (${cs.jobStatus})`;
    } else {
      newStatus = 'failed';
      newMessage = `Coder build ${cs.jobStatus}`;
    }
  } else if (cs.jobStatus === 'succeeded' && lifecycleReady) {
    newStatus = 'ready';
    newMessage =
      cs.lifecycleState === 'ready'
        ? 'Workspace ready'
        : `Workspace usable (lifecycle: ${cs.lifecycleState})`;
    newVscode =
      resolveAppUrl({
        apps: cs.apps,
        slug: 'code-server',
        coderPublicUrl,
        ownerName: cs.ownerName,
        name: cs.name,
      }) ?? sandbox.vscodeUrl;
    newApp =
      resolveAppUrl({
        apps: cs.apps,
        slug: 'app',
        coderPublicUrl,
        ownerName: cs.ownerName,
        name: cs.name,
      }) ?? sandbox.appUrl;
    newSplash =
      resolveAppUrl({
        apps: cs.apps,
        slug: 'splash',
        coderPublicUrl,
        ownerName: cs.ownerName,
        name: cs.name,
      }) ?? sandbox.splashUrl;
    newTerminal = buildLinks({ coderPublicUrl, ownerName: cs.ownerName, name: cs.name }).terminal;
  } else {
    newStatus = 'building';
    newMessage = `job=${cs.jobStatus}${cs.lifecycleState ? `, lifecycle=${cs.lifecycleState}` : ''}`;
  }

  const [updated] = await db
    .update(sandboxes)
    .set({
      status: newStatus,
      statusMessage: newMessage,
      vscodeUrl: newVscode,
      terminalUrl: newTerminal,
      appUrl: newApp,
      splashUrl: newSplash,
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.id, sandbox.id))
    .returning();
  return NextResponse.json({ ...toApiSandbox(updated ?? sandbox), ...githubLink });
}
