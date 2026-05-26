import Link from 'next/link';

import { requireSession } from '@/lib/auth';
import {
  BILLING_GATE_REASON_PARAM,
  BILLING_GATE_SUBSCRIPTION_REQUIRED,
} from '@/lib/billing-gate';
import {
  getOmBillingSummaryForUser,
  reconcileLlmAccessForUser,
  syncOmBillingUsageForUser,
} from '@/lib/om-billing';
import { BillingUsageCard } from '@/components/billing-usage-card';

export const dynamic = 'force-dynamic';

interface BillingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BillingPage({
  searchParams,
}: BillingPageProps): Promise<React.ReactElement> {
  const session = await requireSession();

  // Best-effort reconcile so the page reflects fresh OM access on every load.
  // Webhooks are the primary trigger; this is a fallback.
  await reconcileLlmAccessForUser(session.sub).catch(() => {});
  // Lazy pull of OpenRouter usage; throttled by lastSyncedAt so refreshes don't hammer the provider.
  await syncOmBillingUsageForUser(session.sub).catch(() => {});
  const summary = await getOmBillingSummaryForUser(session.sub);

  const params = await searchParams;
  const reasonRaw = params[BILLING_GATE_REASON_PARAM];
  const reason = Array.isArray(reasonRaw) ? reasonRaw[0] : reasonRaw;
  const subscriptionRequired = reason === BILLING_GATE_SUBSCRIPTION_REQUIRED;

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

      {subscriptionRequired ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900">
          <p className="font-medium">An active subscription is required.</p>
          <p className="mt-1 text-amber-900/80">
            Subscribe below to unlock your dashboard and create sandboxes. If you just completed
            checkout, refresh in a moment — provisioning runs after the payment webhook.
          </p>
        </div>
      ) : null}

      <BillingUsageCard initialSummary={summary} />
    </div>
  );
}
