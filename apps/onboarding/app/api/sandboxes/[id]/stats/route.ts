import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { getWorkspaceMetadata } from '@/lib/coder';

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
    .select({ coderWorkspaceId: sandboxes.coderWorkspaceId })
    .from(sandboxes)
    .where(and(eq(sandboxes.id, id), eq(sandboxes.userId, session.sub)))
    .limit(1);
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sandbox.coderWorkspaceId) {
    return NextResponse.json({ cpu: null, memory: null, diskHome: null });
  }

  try {
    const md = await getWorkspaceMetadata(sandbox.coderWorkspaceId);
    return NextResponse.json(md);
  } catch (e) {
    return NextResponse.json(
      { cpu: null, memory: null, diskHome: null, error: String(e).slice(0, 200) },
      { status: 200 },
    );
  }
}
