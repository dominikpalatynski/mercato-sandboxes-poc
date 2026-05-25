import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { cancelWorkspaceBuild, getWorkspaceStatus } from '@/lib/coder';

export async function POST(
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
    .select({
      id: sandboxes.id,
      coderWorkspaceId: sandboxes.coderWorkspaceId,
      status: sandboxes.status,
    })
    .from(sandboxes)
    .where(and(eq(sandboxes.id, id), eq(sandboxes.userId, session.sub)))
    .limit(1);
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sandbox.coderWorkspaceId) {
    return NextResponse.json({ error: 'Workspace not yet created' }, { status: 409 });
  }

  try {
    const status = await getWorkspaceStatus(sandbox.coderWorkspaceId);
    if (!status.latestBuildId) {
      return NextResponse.json({ error: 'No active build' }, { status: 409 });
    }
    await cancelWorkspaceBuild(status.latestBuildId);
    await db
      .update(sandboxes)
      .set({
        status: 'failed',
        statusMessage: 'Cancelled by user',
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.id, sandbox.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to cancel: ${String(e).slice(0, 300)}` },
      { status: 500 },
    );
  }
}
