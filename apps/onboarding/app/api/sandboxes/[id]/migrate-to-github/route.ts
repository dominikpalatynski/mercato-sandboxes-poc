import { NextResponse } from 'next/server';
import { requireSessionFromRequest } from '@/lib/auth';
import { migrateRepoToGitHub, MigrationError } from '@/lib/github/migrate';

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

  try {
    const result = await migrateRepoToGitHub({ userId: session.sub, sandboxId: id });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof MigrationError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json(
      { error: `Migration failed: ${String(e).slice(0, 500)}` },
      { status: 500 },
    );
  }
}
