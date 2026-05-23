import Link from 'next/link';

import { requireSession } from '@/lib/auth';
import {
  getOmBillingSummaryForUser,
  reconcileLlmAccessForUser,
} from '@/lib/om-billing';
import { BillingUsageCard } from '@/components/billing-usage-card';

export const dynamic = 'force-dynamic';

export default async function BillingPage(): Promise<React.ReactElement> {
  const session = await requireSession();

  // Best-effort reconcile so the page reflects fresh OM access on every load.
  // Webhooks are the primary trigger; this is a fallback.
  await reconcileLlmAccessForUser(session.sub).catch(() => {});
  const summary = await getOmBillingSummaryForUser(session.sub);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session.email}</p>
        </div>
        {summary.canCreateSandbox ? (
          <Link
            href="/sandboxes/new"
            className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            New sandbox
          </Link>
        ) : null}
      </div>

      <BillingUsageCard initialSummary={summary} />
    </div>
  );
}
