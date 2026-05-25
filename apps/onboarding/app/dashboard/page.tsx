import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { getOmBillingSummaryForUser } from '@/lib/om-billing';
import SandboxCards, { type DashboardSandbox } from './sandbox-cards';
import type { SandboxPresetId } from '@/lib/sandbox-presets';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await requireSession();
  const billingSummary = await getOmBillingSummaryForUser(session.sub);
  const rows = await db
    .select({
      id: sandboxes.id,
      name: sandboxes.name,
      presetId: sandboxes.presetId,
      status: sandboxes.status,
      statusMessage: sandboxes.statusMessage,
      createdAt: sandboxes.createdAt,
    })
    .from(sandboxes)
    .where(eq(sandboxes.userId, session.sub))
    .orderBy(desc(sandboxes.createdAt));

  const initial: DashboardSandbox[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    preset_id: r.presetId as SandboxPresetId,
    status: r.status,
    status_message: r.statusMessage,
    created_at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your sandboxes</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session.email}</p>
        </div>
        {billingSummary.canCreateSandbox ? (
          <Link
            href="/sandboxes/new"
            className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            New sandbox
          </Link>
        ) : (
          <Link
            href="/billing"
            className="rounded border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {billingSummary.sandboxQuota.valid && billingSummary.sandboxQuota.reached
              ? 'Sandbox limit reached'
              : 'Open billing to subscribe and activate AI access'}
          </Link>
        )}
      </div>

      <SandboxCards initial={initial} />
    </div>
  );
}
