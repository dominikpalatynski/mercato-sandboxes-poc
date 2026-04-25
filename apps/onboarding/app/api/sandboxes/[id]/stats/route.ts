import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import { getWorkspaceMetadata } from '@/lib/coder';

interface SandboxRow {
  id: string;
  coder_workspace_id: string | null;
  status: string;
}

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

  const result = await query<SandboxRow>(
    'select id, coder_workspace_id, status from sandboxes where id = $1 and user_id = $2',
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sandbox.coder_workspace_id) {
    return NextResponse.json({ cpu: null, memory: null, diskHome: null });
  }

  try {
    const md = await getWorkspaceMetadata(sandbox.coder_workspace_id);
    return NextResponse.json(md);
  } catch (e) {
    return NextResponse.json(
      { cpu: null, memory: null, diskHome: null, error: String(e).slice(0, 200) },
      { status: 200 },
    );
  }
}
