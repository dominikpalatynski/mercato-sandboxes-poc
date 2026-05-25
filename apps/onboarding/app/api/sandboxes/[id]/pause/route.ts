import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { stopWorkspace } from '@/lib/coder';

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
  if (sandbox.status !== 'ready') {
    return NextResponse.json({ error: 'Only ready sandboxes can be paused' }, { status: 409 });
  }

  try {
    await stopWorkspace(sandbox.coderWorkspaceId);
    await db
      .update(sandboxes)
      .set({
        status: 'building',
        statusMessage: 'Stopping workspace…',
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.id, sandbox.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to pause workspace: ${String(e).slice(0, 300)}` },
      { status: 500 },
    );
  }
}
