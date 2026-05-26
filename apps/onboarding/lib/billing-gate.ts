import { redirect } from 'next/navigation';

import { requireSession, type SessionPayload } from '@/lib/auth';
import {
  getOmBillingSummaryForUser,
  type OmBillingSummary,
} from '@/lib/om-billing';
import { hasGrantedAccess } from '@/lib/openmercato-subscriptions';

export const BILLING_GATE_REASON_PARAM = 'reason';
export const BILLING_GATE_SUBSCRIPTION_REQUIRED = 'subscription_required';

export interface ActiveBillingContext {
  session: SessionPayload;
  summary: OmBillingSummary;
}

export async function requireActiveBilling(): Promise<ActiveBillingContext> {
  const session = await requireSession();
  const summary = await getOmBillingSummaryForUser(session.sub);
  if (!hasGrantedAccess(summary.accessSnapshot)) {
    redirect(`/billing?${BILLING_GATE_REASON_PARAM}=${BILLING_GATE_SUBSCRIPTION_REQUIRED}`);
  }
  return { session, summary };
}
