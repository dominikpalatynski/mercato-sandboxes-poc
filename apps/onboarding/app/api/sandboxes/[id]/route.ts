import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import { deleteWorkspace } from '@/lib/coder';

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

  const result = await query<{ id: string; coder_workspace_id: string | null }>(
    'select id, coder_workspace_id from sandboxes where id = $1 and user_id = $2',
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (sandbox.coder_workspace_id) {
    try {
      await deleteWorkspace(sandbox.coder_workspace_id);
    } catch (e) {
      // Non-fatal: workspace may already be gone or in a bad state.
      console.warn(`[delete] coder workspace ${sandbox.coder_workspace_id}:`, String(e).slice(0, 300));
    }
  }

  await query('delete from sandboxes where id = $1', [sandbox.id]);
  return new NextResponse(null, { status: 204 });
}
