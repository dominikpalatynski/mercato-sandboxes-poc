export const BILLING_PLAN_TYPES = ['activation', 'topup'] as const;
export type BillingPlanType = (typeof BILLING_PLAN_TYPES)[number];

export const BILLING_ERROR_CODES = {
  AI_ENTITLEMENT_REQUIRED: 'ai_entitlement_required',
  INVALID_PLAN_TRANSITION: 'invalid_plan_transition',
  INVALID_WEBHOOK_SIGNATURE: 'invalid_webhook_signature',
  INTERNAL_SYNC_AUTH_FAILED: 'internal_sync_auth_failed',
  ORDER_NOT_FOUND: 'billing_order_not_found',
  PAYMENT_AMOUNT_MISMATCH: 'payment_amount_mismatch',
  PROVIDER_CONFIGURATION_MISSING: 'provider_configuration_missing',
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

export interface BillingOrderSummary {
  id: string;
  provider_order_id: string | null;
  status: string;
  plan_type: BillingPlanType;
  amount_pln: number;
  credits_usd: number;
  created_at: string;
  paid_at: string | null;
}

export interface LlmAccountSummary {
  id: string;
  provider: string;
  openrouter_key_label: string;
  status: string;
  coder_secret_sync_state: string;
  limit_usd: number;
  limit_reset: string | null;
  last_synced_at: string | null;
}

export interface LlmUsageSnapshotSummary {
  usage_total_usd: number;
  usage_monthly_usd: number;
  limit_remaining_usd: number;
  observed_at: string;
}

export interface BillingSummary {
  has_paid_order: boolean;
  latest_order: BillingOrderSummary | null;
  llm_account: LlmAccountSummary | null;
  latest_usage: LlmUsageSnapshotSummary | null;
  can_create_sandbox: boolean;
}
