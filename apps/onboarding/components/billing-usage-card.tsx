'use client';

import { useState } from 'react';

import { formatRelative } from '@/lib/relative-time';
import { readEntitlementsView } from '@/lib/openmercato-subscriptions';
import type { OmBillingSummary } from '@/lib/om-billing';
import { Badge } from '@/components/ui/badge';
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
    return '—';
  }
  return `$${amount.toFixed(2)}`;
}

function formatAbsoluteDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function percent(used: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

type AccessTone = 'success' | 'warning' | 'destructive' | 'muted';

function accessBadge(state: string | null | undefined): { label: string; tone: AccessTone } {
  switch (state) {
    case 'granted':
      return { label: 'Active', tone: 'success' };
    case 'grace':
      return { label: 'Grace period', tone: 'warning' };
    case 'pending':
      return { label: 'Pending', tone: 'muted' };
    case 'blocked':
      return { label: 'Blocked', tone: 'destructive' };
    default:
      return { label: 'Not provisioned', tone: 'muted' };
  }
}

const TONE_CLASSES: Record<AccessTone, string> = {
  success: 'border-transparent bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20',
  warning: 'border-transparent bg-amber-500/15 text-amber-800 hover:bg-amber-500/20',
  destructive: 'border-transparent bg-destructive/15 text-destructive hover:bg-destructive/20',
  muted: 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80',
};

interface UsageRowProps {
  label: string;
  value: string;
  percent: number;
  caption?: string;
  unavailable?: boolean;
}

function UsageRow({
  label,
  value,
  percent: pct,
  caption,
  unavailable,
}: UsageRowProps): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={unavailable ? undefined : pct}
        aria-label={label}
      >
        <div
          className={
            unavailable
              ? 'h-full w-0'
              : pct >= 90
                ? 'h-full bg-destructive transition-all'
                : pct >= 70
                  ? 'h-full bg-amber-500 transition-all'
                  : 'h-full bg-primary transition-all'
          }
          style={{ width: unavailable ? '0%' : `${pct}%` }}
        />
      </div>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

export function BillingUsageCard({ initialSummary }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessState = initialSummary.accessSnapshot?.accessState ?? null;
  const entitlements = readEntitlementsView(initialSummary.accessSnapshot?.entitlements ?? null);
  const planLabel =
    initialSummary.accessSnapshot?.planCode
    ?? initialSummary.accessSnapshot?.priceCode
    ?? 'basic-sandbox';
  const hasAnySubscription = Boolean(initialSummary.accessSnapshot?.subscriptionId);

  const aiLimit = entitlements.openRouterTokensUsageUsd ?? initialSummary.llmAccount?.limitUsd ?? null;
  const aiUsed = initialSummary.latestUsage?.usageMonthlyUsd ?? 0;
  const aiPct = percent(aiUsed, aiLimit);
  const aiHasLimit = typeof aiLimit === 'number' && aiLimit > 0;

  const quota = initialSummary.sandboxQuota;
  const sandboxPct = quota.valid && quota.limit ? percent(quota.used, quota.limit) : 0;

  const periodEnd = initialSummary.accessSnapshot?.currentPeriodEnd ?? null;
  const periodEndAbsolute = formatAbsoluteDate(periodEnd);
  const periodEndRelative = periodEnd ? formatRelative(periodEnd) : null;
  const cancelAtPeriodEnd = Boolean(initialSummary.accessSnapshot?.cancelAtPeriodEnd);

  const access = accessBadge(accessState);

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
        <CardDescription>Your plan, AI usage, and sandbox quota.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-foreground">{planLabel}</span>
              <Badge className={TONE_CLASSES[access.tone]}>{access.label}</Badge>
            </div>
            {periodEndAbsolute ? (
              <p className="text-sm text-muted-foreground">
                {cancelAtPeriodEnd ? 'Ends' : 'Renews'} {periodEndAbsolute}
                {periodEndRelative ? <span> · {periodEndRelative}</span> : null}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No active billing period.</p>
            )}
          </div>
        </div>

        <div className="space-y-5 border-t border-border pt-5">
          <UsageRow
            label="AI usage this month"
            value={aiHasLimit ? `${formatUsd(aiUsed)} / ${formatUsd(aiLimit)}` : formatUsd(aiUsed)}
            percent={aiPct}
            unavailable={!aiHasLimit}
            caption={aiHasLimit ? undefined : 'No AI budget on the current plan.'}
          />
          <UsageRow
            label="Sandboxes"
            value={
              quota.valid && quota.limit !== null
                ? `${quota.used} / ${quota.limit}`
                : `${quota.used}`
            }
            percent={sandboxPct}
            unavailable={!quota.valid}
            caption={quota.valid ? undefined : 'No sandbox quota on the current plan.'}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!initialSummary.canCreateSandbox ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
            {quota.valid && quota.reached
              ? 'Your plan sandbox limit is reached. Delete an existing sandbox or upgrade your plan to create another.'
              : 'Sandbox creation is blocked until your subscription and AI access are fully provisioned.'}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex items-center justify-start gap-3">
        <Button type="button" disabled={busy} onClick={startBillingAction}>
          {busy
            ? hasAnySubscription
              ? 'Opening portal…'
              : 'Opening checkout…'
            : hasAnySubscription
              ? 'Manage subscription'
              : 'Subscribe'}
        </Button>
      </CardFooter>
    </Card>
  );
}
