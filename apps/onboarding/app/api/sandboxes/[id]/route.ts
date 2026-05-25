import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { deleteWorkspace } from '@/lib/coder';
import { deleteWorkspaceCredsSecret } from '@/lib/k8s/workspace-secrets';

export async function DELETE(
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
    .select({ id: sandboxes.id, coderWorkspaceId: sandboxes.coderWorkspaceId })
    .from(sandboxes)
    .where(and(eq(sandboxes.id, id), eq(sandboxes.userId, session.sub)))
    .limit(1);
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (sandbox.coderWorkspaceId) {
    try {
      await deleteWorkspace(sandbox.coderWorkspaceId);
    } catch (e) {
      console.warn(`[delete] coder workspace ${sandbox.coderWorkspaceId}:`, String(e).slice(0, 300));
    }
  }

  try {
    await deleteWorkspaceCredsSecret(sandbox.id);
  } catch (e) {
    console.warn(`[delete] workspace creds Secret for ${sandbox.id}:`, String(e).slice(0, 300));
  }

  await db.delete(sandboxes).where(eq(sandboxes.id, sandbox.id));
  return new NextResponse(null, { status: 204 });
}
