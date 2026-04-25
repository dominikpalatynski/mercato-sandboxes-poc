import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import {
  getAgentLogs,
  getBuildLogs,
  getWorkspaceStatus,
  type CoderLogLine,
} from '@/lib/coder';

interface SandboxRow {
  id: string;
  coder_workspace_id: string | null;
}

/**
 * GET /api/sandboxes/{id}/logs?buildAfter=N&agentAfter=M
 *
 * Returns:
 *   {
 *     buildLogs:  CoderLogLine[],   // provisioner (terraform/docker) lines after `buildAfter`
 *     agentLogs:  CoderLogLine[],   // startup_script lines after `agentAfter`
 *     buildId:    string | null,
 *     agentId:    string | null,
 *     jobStatus:  string | null,
 *     lifecycleState: string | null,
 *   }
 */
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
  const url = new URL(req.url);
  const buildAfter = Number(url.searchParams.get('buildAfter') ?? '0') || 0;
  const agentAfter = Number(url.searchParams.get('agentAfter') ?? '0') || 0;

  const result = await query<SandboxRow>(
    'select id, coder_workspace_id from sandboxes where id = $1 and user_id = $2',
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!sandbox.coder_workspace_id) {
    return NextResponse.json({
      buildLogs: [],
      agentLogs: [],
      buildId: null,
      agentId: null,
      jobStatus: null,
      lifecycleState: null,
    });
  }

  let buildId: string | null = null;
  let agentId: string | null = null;
  let jobStatus: string | null = null;
  let lifecycleState: string | null = null;
  try {
    const status = await getWorkspaceStatus(sandbox.coder_workspace_id);
    buildId = status.latestBuildId;
    agentId = status.agentId;
    jobStatus = status.jobStatus;
    lifecycleState = status.lifecycleState;
  } catch {
    // Best-effort: return empty arrays so the UI keeps polling.
    return NextResponse.json({
      buildLogs: [],
      agentLogs: [],
      buildId: null,
      agentId: null,
      jobStatus: null,
      lifecycleState: null,
    });
  }

  const [buildLogs, agentLogs] = await Promise.all([
    buildId
      ? getBuildLogs(buildId, buildAfter).catch((): CoderLogLine[] => [])
      : Promise.resolve<CoderLogLine[]>([]),
    agentId
      ? getAgentLogs(agentId, agentAfter).catch((): CoderLogLine[] => [])
      : Promise.resolve<CoderLogLine[]>([]),
  ]);

  return NextResponse.json({
    buildLogs,
    agentLogs,
    buildId,
    agentId,
    jobStatus,
    lifecycleState,
  });
}
