import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';

interface SandboxRow {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
  created_at: Date;
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requireSession();
  const { rows } = await query<SandboxRow>(
    `select id, name, status, status_message, vscode_url, terminal_url, app_url, splash_url, created_at
       from sandboxes
      where user_id = $1
      order by created_at desc`,
    [session.sub],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your sandboxes</h1>
          <p className="text-sm text-gray-400">Signed in as {session.email}</p>
        </div>
        <Link
          href="/sandboxes/new"
          className="rounded bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
        >
          New sandbox
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-white/15 p-8 text-center text-gray-400">
          You don&apos;t have any sandboxes yet. Click <span className="text-gray-200">New sandbox</span> to spin one up.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-white/10 bg-white/5 p-4"
            >
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-gray-400">
                  {s.status}
                  {s.status_message ? ` — ${s.status_message}` : ''}
                </div>
              </div>
              <Link href={`/sandboxes/${s.id}`} className="text-sm text-indigo-300 hover:underline">
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
