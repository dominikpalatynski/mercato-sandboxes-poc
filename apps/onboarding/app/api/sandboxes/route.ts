import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db';
import { requireSessionFromRequest } from '@/lib/auth';
import { ensureCoderUser, createWorkspace } from '@/lib/coder';

interface SandboxListRow {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  coder_workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }
  const { rows } = await query<SandboxListRow>(
    `select id, name, status, status_message, coder_workspace_id, created_at, updated_at
       from sandboxes
      where user_id = $1
      order by created_at desc`,
    [session.sub],
  );
  return NextResponse.json({ sandboxes: rows });
}

const Body = z.object({
  name: z.string().regex(/^[a-z0-9-]{3,32}$/, {
    message: 'Name must be 3-32 chars, lowercase letters, digits and dashes only.',
  }),
});

interface UserRow {
  id: string;
  email: string;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_temp_password: string | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid name' },
      { status: 400 },
    );
  }
  const name = parsed.data.name;

  // Load user.
  const userResult = await query<UserRow>(
    'select id, email, coder_user_id, coder_username, coder_temp_password from users where id = $1',
    [session.sub],
  );
  const user = userResult.rows[0];
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Provision Coder user if needed.
  let coderUserId = user.coder_user_id;
  if (!coderUserId) {
    try {
      const created = await ensureCoderUser(user.email);
      await query(
        'update users set coder_user_id = $1, coder_username = $2, coder_temp_password = $3 where id = $4',
        [created.id, created.username, created.tempPassword, user.id],
      );
      coderUserId = created.id;
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to create Coder user: ${String(e).slice(0, 500)}` },
        { status: 500 },
      );
    }
  }

  // Insert sandbox row in 'building' state.
  const inserted = await query<{ id: string }>(
    `insert into sandboxes (user_id, name, status, status_message)
     values ($1, $2, 'building', $3)
     returning id`,
    [user.id, name, 'Creating workspace…'],
  );
  const dbSandboxId = inserted.rows[0]?.id;
  if (!dbSandboxId) {
    return NextResponse.json({ error: 'Failed to create sandbox row' }, { status: 500 });
  }

  try {
    const ws = await createWorkspace(coderUserId, name);
    await query(
      `update sandboxes
          set coder_workspace_id = $1, status_message = $2, updated_at = now()
        where id = $3`,
      [ws.id, 'Provisioning…', dbSandboxId],
    );
  } catch (e) {
    await query(
      `update sandboxes
          set status = 'failed', status_message = $1, updated_at = now()
        where id = $2`,
      [String(e).slice(0, 500), dbSandboxId],
    );
    return NextResponse.json({ id: dbSandboxId, error: String(e) }, { status: 500 });
  }

  return NextResponse.json({ id: dbSandboxId }, { status: 201 });
}
