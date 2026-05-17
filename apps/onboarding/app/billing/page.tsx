import Link from 'next/link';

import { requireSession } from '@/lib/auth';
import { getBillingSummaryForUser } from '@/lib/billing';
import { BillingUsageCard } from '@/components/billing-usage-card';

export const dynamic = 'force-dynamic';

export default async function BillingPage(): Promise<React.ReactElement> {
  const session = await requireSession();
  const billingSummary = await getBillingSummaryForUser(session.sub);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session.email}</p>
        </div>
        {billingSummary.can_create_sandbox ? (
          <Link
            href="/sandboxes/new"
            className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            New sandbox
          </Link>
        ) : null}
      </div>

      <BillingUsageCard initialSummary={billingSummary} />
    </div>
  );
}
