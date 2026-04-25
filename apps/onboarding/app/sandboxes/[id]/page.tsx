import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';
import StatusPoller, { type SandboxView } from './status-poller';

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
  created_at: Date;
  updated_at: Date;
}

interface UserCreds {
  email: string;
  coder_temp_password: string | null;
  coder_username: string | null;
}

export const dynamic = 'force-dynamic';

export default async function SandboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const result = await query<SandboxRow>(
    `select id, user_id, name, coder_workspace_id, status, status_message,
            vscode_url, terminal_url, app_url, splash_url, created_at, updated_at
       from sandboxes
      where id = $1 and user_id = $2`,
    [id, session.sub],
  );
  const sandbox = result.rows[0];
  if (!sandbox) notFound();

  const userResult = await query<UserCreds>(
    'select email, coder_temp_password, coder_username from users where id = $1',
    [session.sub],
  );
  const user = userResult.rows[0];

  const initial: SandboxView = {
    id: sandbox.id,
    name: sandbox.name,
    status: sandbox.status,
    status_message: sandbox.status_message,
    vscode_url: sandbox.vscode_url,
    terminal_url: sandbox.terminal_url,
    app_url: sandbox.app_url,
    splash_url: sandbox.splash_url,
    coder_owner_name: user?.coder_username ?? null,
    coder_workspace_name: sandbox.name,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{sandbox.name}</h1>
          <p className="text-xs text-gray-400">id: {sandbox.id}</p>
        </div>
        <Link href="/dashboard" className="text-sm text-indigo-300 hover:underline">
          Back to dashboard
        </Link>
      </div>

      <StatusPoller
        initial={initial}
        coderEmail={user?.email ?? session.email}
        coderTempPassword={user?.coder_temp_password ?? null}
      />
    </div>
  );
}
