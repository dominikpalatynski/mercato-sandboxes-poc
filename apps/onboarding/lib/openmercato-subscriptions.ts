import {
  createOpenMercatoClient,
  type OpenMercatoClient,
} from '@/lib/openmercato-client';

export const SUBSCRIPTION_SUBJECT_ENTITY_TYPE = 'customers:customer_person_profile';
export const DEFAULT_PRODUCT_CODE = 'basic-sandbox';
export const DEFAULT_PRICE_CODE = 'basic-monthly-pln-v1';

export const SUBSCRIPTION_ACCESS_STATES = ['pending', 'granted', 'grace', 'blocked'] as const;
export type SubscriptionAccessState = (typeof SUBSCRIPTION_ACCESS_STATES)[number];

export interface CreateSubscriptionCheckoutInput {
  externalAccountId: string;
  subjectEntityId: string;
  priceCode?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CreateSubscriptionCheckoutResponse {
  checkoutUrl: string;
  provider: 'stripe';
  subscriptionRequestId: string;
}

export interface CreateSubscriptionPortalInput {
  externalAccountId: string;
  returnUrl: string;
}

export interface CreateSubscriptionPortalResponse {
  portalUrl: string;
}

export interface SubscriptionAccessSnapshot {
  subscriptionId: string | null;
  externalAccountId: string;
  productCode: string;
  planCode: string | null;
  priceCode: string | null;
  provider: string | null;
  providerStatus: string | null;
  accessState: SubscriptionAccessState;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  entitlements: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface OpenMercatoSubscriptionsClientDependencies {
  client?: Pick<OpenMercatoClient, 'get' | 'post'>;
}

function resolveClient(
  deps: OpenMercatoSubscriptionsClientDependencies,
): Pick<OpenMercatoClient, 'get' | 'post'> {
  return deps.client ?? createOpenMercatoClient();
}

export async function createSubscriptionCheckout(
  input: CreateSubscriptionCheckoutInput,
  deps: OpenMercatoSubscriptionsClientDependencies = {},
): Promise<CreateSubscriptionCheckoutResponse> {
  const client = resolveClient(deps);
  return client.post<CreateSubscriptionCheckoutResponse, Record<string, unknown>>(
    '/api/subscriptions/checkout',
    {
      externalAccountId: input.externalAccountId,
      subjectEntityType: SUBSCRIPTION_SUBJECT_ENTITY_TYPE,
      subjectEntityId: input.subjectEntityId,
      priceCode: input.priceCode ?? DEFAULT_PRICE_CODE,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  );
}

export async function createSubscriptionPortal(
  input: CreateSubscriptionPortalInput,
  deps: OpenMercatoSubscriptionsClientDependencies = {},
): Promise<CreateSubscriptionPortalResponse> {
  const client = resolveClient(deps);
  return client.post<CreateSubscriptionPortalResponse, Record<string, unknown>>(
    '/api/subscriptions/portal',
    {
      externalAccountId: input.externalAccountId,
      returnUrl: input.returnUrl,
    },
  );
}

export interface GetSubscriptionAccessInput {
  externalAccountId: string;
  productCode?: string;
}

export async function getSubscriptionAccess(
  input: GetSubscriptionAccessInput,
  deps: OpenMercatoSubscriptionsClientDependencies = {},
): Promise<SubscriptionAccessSnapshot> {
  const client = resolveClient(deps);
  return client.get<SubscriptionAccessSnapshot>('/api/subscriptions/access', {
    query: {
      externalAccountId: input.externalAccountId,
      productCode: input.productCode ?? DEFAULT_PRODUCT_CODE,
    },
  });
}

export interface EntitlementsView {
  sandboxCount: number | null;
  openRouterTokensUsageUsd: number | null;
}

export function readEntitlementsView(
  entitlements: Record<string, unknown> | null | undefined,
): EntitlementsView {
  const sandboxCountRaw = entitlements?.sandboxCount;
  const usageRaw = entitlements?.openRouterTokensUsageUsd;
  const sandboxCount = typeof sandboxCountRaw === 'number' && Number.isFinite(sandboxCountRaw)
    ? sandboxCountRaw
    : null;
  const openRouterTokensUsageUsd = typeof usageRaw === 'number' && Number.isFinite(usageRaw)
    ? usageRaw
    : null;
  return { sandboxCount, openRouterTokensUsageUsd };
}

export function hasGrantedAccess(snapshot: SubscriptionAccessSnapshot | null): boolean {
  return snapshot?.accessState === 'granted' || snapshot?.accessState === 'grace';
}
