import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import { stopWorkspace } from '@/lib/coder';

interface SandboxRow {
  id: string;
  coder_workspace_id: string | null;
  status: string;
}

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

  const result = await query<SandboxRow>(
    'select id, coder_workspace_id, status from sandboxes where id = $1 and user_id = $2',
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sandbox.coder_workspace_id) {
    return NextResponse.json({ error: 'Workspace not yet created' }, { status: 409 });
  }
  if (sandbox.status !== 'ready') {
    return NextResponse.json({ error: 'Only ready sandboxes can be paused' }, { status: 409 });
  }

  try {
    await stopWorkspace(sandbox.coder_workspace_id);
    await query(
      `update sandboxes
          set status = 'building', status_message = 'Stopping workspace…', updated_at = now()
        where id = $1`,
      [sandbox.id],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to pause workspace: ${String(e).slice(0, 300)}` },
      { status: 500 },
    );
  }
}
