'use client';

import { useState, type FormEvent } from 'react';

import type { BillingSummary } from '@/lib/billing-types';
import { formatRelative } from '@/lib/relative-time';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  initialSummary: BillingSummary;
}

function formatUsd(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'n/a';
  }
  return `$${amount.toFixed(2)}`;
}

function formatPln(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'n/a';
  }
  return `${amount.toFixed(2)} PLN`;
}

function formatObservedAt(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }
  return formatRelative(value);
}

export function BillingUsageCard({ initialSummary }: Props): React.ReactElement {
  const [creditsUsd, setCreditsUsd] = useState(
    initialSummary.llm_account ? String(Math.max(initialSummary.llm_account.limit_usd, 25)) : '50',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = initialSummary.llm_account?.status === 'active'
    && initialSummary.llm_account?.coder_secret_sync_state === 'synced';
  const actionLabel = isActive ? 'Top up AI balance' : 'Activate AI access';

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const parsedCredits = Number(creditsUsd);
    if (!Number.isFinite(parsedCredits) || parsedCredits <= 0) {
      setError('Enter a valid USD credit amount.');
      setBusy(false);
      return;
    }

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_type: isActive ? 'topup' : 'activation',
          credits_usd: parsedCredits,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        payment_url?: string;
        error?: string;
      };
      if (!res.ok || !data.payment_url) {
        setError(data.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      window.location.assign(data.payment_url);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          Review AI entitlement status, current OpenRouter usage snapshots, and add more budget when
          needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Status
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {initialSummary.llm_account
                ? `${initialSummary.llm_account.status} / ${initialSummary.llm_account.coder_secret_sync_state}`
                : 'not activated'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Remaining budget
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(
                initialSummary.latest_usage?.limit_remaining_usd
                ?? initialSummary.llm_account?.limit_usd,
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Usage this month
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(initialSummary.latest_usage?.usage_monthly_usd)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Total observed usage
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {formatUsd(initialSummary.latest_usage?.usage_total_usd)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Latest snapshot
            </div>
            <div
              className="mt-1 text-sm font-medium text-foreground"
              title={initialSummary.latest_usage?.observed_at || undefined}
            >
              {formatObservedAt(initialSummary.latest_usage?.observed_at)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Latest order
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {initialSummary.latest_order
                ? `${initialSummary.latest_order.status} • ${formatPln(initialSummary.latest_order.amount_pln)}`
                : 'none yet'}
            </div>
          </div>
        </div>

        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="creditsUsd">Credits to provision (USD budget)</Label>
            <Input
              id="creditsUsd"
              name="creditsUsd"
              type="number"
              min="1"
              step="0.01"
              value={creditsUsd}
              onChange={(e) => setCreditsUsd(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Alpha billing converts this USD budget to the provider-side PLN checkout amount.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!initialSummary.can_create_sandbox ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900">
              Sandbox creation stays blocked until a paid webhook activates your AI entitlement and
              Coder secrets are synchronized.
            </div>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? 'Redirecting to payment…' : actionLabel}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        The raw OpenRouter key stays server-side and is synchronized into Coder user secrets only.
      </CardFooter>
    </Card>
  );
}
