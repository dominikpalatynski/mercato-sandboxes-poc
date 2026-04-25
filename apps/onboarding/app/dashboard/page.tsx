import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';

interface SandboxRow {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  created_at: Date;
}

export const dynamic = 'force-dynamic';

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'failed':
      return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'building':
    case 'pending':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    default:
      return 'bg-white/10 text-gray-300 border-white/20';
  }
}

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
        <div className="rounded border border-dashed border-white/15 p-8 text-center text-gray-400">
          You have no sandboxes yet — create one to get started.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-white/10 bg-white/5 p-4"
            >
              <div className="space-y-1">
                <Link href={`/sandboxes/${s.id}`} className="font-medium text-gray-100 hover:underline">
                  {s.name}
                </Link>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className={`rounded border px-2 py-0.5 uppercase tracking-wide ${statusBadgeClass(s.status)}`}>
                    {s.status}
                  </span>
                  {s.status_message ? <span>{s.status_message}</span> : null}
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
