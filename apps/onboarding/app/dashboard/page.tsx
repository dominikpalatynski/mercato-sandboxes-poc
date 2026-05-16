import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getBillingSummaryForUser } from '@/lib/billing';
import SandboxCards, { type DashboardSandbox } from './sandbox-cards';
import BillingCard from './billing-card';

interface SandboxRow {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  created_at: Date;
}

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await requireSession();
  const billingSummary = await getBillingSummaryForUser(session.sub);
  const { rows } = await query<SandboxRow>(
    `select id, name, status, status_message, created_at
       from sandboxes
      where user_id = $1
      order by created_at desc`,
    [session.sub],
  );

  const initial: DashboardSandbox[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    status_message: r.status_message,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your sandboxes</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session.email}</p>
        </div>
        {billingSummary.can_create_sandbox ? (
          <Link
            href="/sandboxes/new"
            className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            New sandbox
          </Link>
        ) : (
          <span className="rounded border border-border px-4 py-2 text-sm text-muted-foreground">
            Activate AI access to create a sandbox
          </span>
        )}
      </div>

      <BillingCard initialSummary={billingSummary} />
      <SandboxCards initial={initial} />
    </div>
  );
}
