import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import { buildLinks, coderPublicUrl, getWorkspaceStatus } from '@/lib/coder';

interface SandboxRow {
  id: string;
  user_id: string;
  name: string;
  coder_workspace_id: string | null;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
  created_at: string;
  updated_at: string;
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
    `select id, user_id, name, coder_workspace_id, status, status_message,
            vscode_url, terminal_url, app_url, splash_url, created_at, updated_at
       from sandboxes
      where id = $1 and user_id = $2`,
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Terminal states: don't re-poll Coder.
  if (sandbox.status === 'ready' || sandbox.status === 'failed') {
    return NextResponse.json(sandbox);
  }

  if (!sandbox.coder_workspace_id) {
    return NextResponse.json(sandbox);
  }

  let cs;
  try {
    cs = await getWorkspaceStatus(sandbox.coder_workspace_id);
  } catch (e) {
    // Transient API errors — return current row, will retry next poll.
    return NextResponse.json({
      ...sandbox,
      status_message: `Polling Coder failed: ${String(e).slice(0, 200)}`,
    });
  }

  let newStatus = sandbox.status;
  let newMessage = sandbox.status_message ?? '';
  let newVscode = sandbox.vscode_url;
  let newTerminal = sandbox.terminal_url;
  let newApp = sandbox.app_url;
  let newSplash = sandbox.splash_url;

  const lifecycleReady =
    cs.lifecycleState === 'ready' ||
    cs.lifecycleState === 'start_timeout' ||
    cs.lifecycleState === 'start_error';

  if (cs.jobStatus === 'failed' || cs.jobStatus === 'canceled') {
    newStatus = 'failed';
    newMessage = `Coder build ${cs.jobStatus}`;
  } else if (cs.jobStatus === 'succeeded' && lifecycleReady) {
    newStatus = 'ready';
    newMessage =
      cs.lifecycleState === 'ready'
        ? 'Workspace ready'
        : `Workspace usable (lifecycle: ${cs.lifecycleState})`;
    const links = buildLinks({
      coderPublicUrl,
      ownerName: cs.ownerName,
      name: cs.name,
    });
    newVscode = links.vscode;
    newTerminal = links.terminal;
    newApp = links.app;
    newSplash = links.splash;
  } else {
    newStatus = 'building';
    newMessage = `job=${cs.jobStatus}${cs.lifecycleState ? `, lifecycle=${cs.lifecycleState}` : ''}`;
  }

  const updated = await query<SandboxRow>(
    `update sandboxes
        set status = $1,
            status_message = $2,
            vscode_url = $3,
            terminal_url = $4,
            app_url = $5,
            splash_url = $6,
            updated_at = now()
      where id = $7
      returning id, user_id, name, coder_workspace_id, status, status_message,
                vscode_url, terminal_url, app_url, splash_url, created_at, updated_at`,
    [newStatus, newMessage, newVscode, newTerminal, newApp, newSplash, sandbox.id],
  );
  return NextResponse.json(updated.rows[0] ?? sandbox);
}
