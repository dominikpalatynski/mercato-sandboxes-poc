'use client';

import { useState } from 'react';

import { formatRelative } from '@/lib/relative-time';
import { readEntitlementsView } from '@/lib/openmercato-subscriptions';
import type { OmBillingSummary } from '@/lib/om-billing';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Props {
  initialSummary: OmBillingSummary;
}

function formatUsd(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'n/a';
  }
  return `$${amount.toFixed(2)}`;
}

function formatObservedAt(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }
  return formatRelative(value);
}

function formatAccessState(state: string | null | undefined): string {
  if (!state) return 'not provisioned';
  return state;
}

function formatSandboxQuota(quota: OmBillingSummary['sandboxQuota']): string {
  if (!quota.valid || quota.limit === null) {
    return 'n/a';
  }
  return `${quota.used}/${quota.limit}`;
}

export function BillingUsageCard({ initialSummary }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessState = initialSummary.accessSnapshot?.accessState ?? null;
  const entitlements = readEntitlementsView(initialSummary.accessSnapshot?.entitlements ?? null);
  const planLabel = initialSummary.accessSnapshot?.planCode
    ?? initialSummary.accessSnapshot?.priceCode
    ?? 'basic-sandbox';
  const hasAnySubscription = Boolean(initialSummary.accessSnapshot?.subscriptionId);

  async function startBillingAction(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const actionUrl = hasAnySubscription ? '/api/billing/portal' : '/api/billing/checkout';
      const res = await fetch(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkout_url?: string;
        portal_url?: string;
        error?: string;
      };
      const redirectUrl = hasAnySubscription ? data.portal_url : data.checkout_url;
      if (!res.ok || !redirectUrl) {
        setError(data.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>
          Manage your sandbox subscription, AI access entitlements, and OpenRouter usage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Plan</div>
            <div className="mt-1 text-sm font-medium text-foreground">{planLabel}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Access state
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatAccessState(accessState)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              AI account status
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {initialSummary.llmAccount
                ? `${initialSummary.llmAccount.status} / ${initialSummary.llmAccount.secretSyncState}`
                : 'not provisioned'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Plan AI budget
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(entitlements.openRouterTokensUsageUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Sandboxes
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatSandboxQuota(initialSummary.sandboxQuota)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Remaining budget
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(
                initialSummary.latestUsage?.limitRemainingUsd
                ?? initialSummary.llmAccount?.limitUsd,
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Usage this month
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(initialSummary.latestUsage?.usageMonthlyUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Total observed usage
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(initialSummary.latestUsage?.usageTotalUsd)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Latest snapshot
            </div>
            <div
              className="mt-1 text-sm font-medium text-foreground"
              title={initialSummary.latestUsage?.observedAt || undefined}
            >
              {formatObservedAt(initialSummary.latestUsage?.observedAt)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Renews at
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatObservedAt(initialSummary.accessSnapshot?.currentPeriodEnd)}
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!initialSummary.canCreateSandbox ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
            {initialSummary.sandboxQuota.valid && initialSummary.sandboxQuota.reached
              ? 'Your current plan sandbox limit is reached. Delete an existing sandbox or update the subscription before creating another one.'
              : 'Sandbox creation stays blocked until Open Mercato confirms your subscription is granted, your AI access is provisioned, and your plan exposes a valid sandbox limit.'}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" disabled={busy} onClick={startBillingAction}>
            {busy
              ? hasAnySubscription
                ? 'Redirecting to billing portal…'
                : 'Redirecting to checkout…'
              : hasAnySubscription
                ? 'Manage subscription'
                : 'Subscribe'}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Payments are processed by Open Mercato (Stripe). AI access is provisioned automatically once
        the subscription is granted.
      </CardFooter>
    </Card>
  );
}
