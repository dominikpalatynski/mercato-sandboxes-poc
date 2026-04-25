import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';
import StatusBadge from '@/components/status-badge';
import { formatRelative } from '@/lib/relative-time';

interface SandboxRow {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  created_at: Date;
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await requireSession();
  const { rows } = await query<SandboxRow>(
    `select id, name, status, status_message, created_at
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
        <div className="mx-auto max-w-md rounded-lg border border-slate-700/50 bg-slate-900/40 p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-100">No sandboxes yet</h2>
          <p className="mt-1 text-sm text-gray-400">
            Spin up a fresh Open Mercato development environment in a couple of minutes.
          </p>
          <Link
            href="/sandboxes/new"
            className="mt-4 inline-block rounded bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Create your first sandbox
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-slate-700/50 bg-slate-900/40 p-4 transition hover:bg-slate-800/50"
            >
              <div className="space-y-1">
                <Link href={`/sandboxes/${s.id}`} className="font-medium text-gray-100 hover:underline">
                  {s.name}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <StatusBadge status={s.status} />
                  <span>created {formatRelative(s.created_at)}</span>
                  {s.status_message ? <span>· {s.status_message}</span> : null}
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
