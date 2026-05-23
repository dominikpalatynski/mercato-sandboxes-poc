import { createHmac } from 'node:crypto'

type AccessChangedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  externalAccountId: string
  accessState: 'pending' | 'granted' | 'grace' | 'blocked'
  providerStatus: string
}

type Ctx = {
  resolve?: <T = unknown>(name: string) => T
  container?: { resolve: <T = unknown>(name: string) => T }
}

export const metadata = {
  event: 'subscriptions.access.changed',
  persistent: true,
  id: 'onboarding_bridge.forward-access-changed',
}

function readConfig() {
  const url = process.env.ONBOARDING_WEBHOOK_URL?.trim()
  const secret = process.env.ONBOARDING_WEBHOOK_SECRET?.trim()
  const productCode = process.env.ONBOARDING_WEBHOOK_PRODUCT_CODE?.trim() || 'basic-sandbox'
  if (!url || !secret) {
    return null
  }
  return { url, secret, productCode }
}

async function loadEntitlements(
  ctx: Ctx,
  scope: { tenantId: string; organizationId: string },
  externalAccountId: string,
  productCode: string,
): Promise<Record<string, unknown> | null> {
  const resolve = (typeof ctx.resolve === 'function'
    ? ctx.resolve
    : ctx.container?.resolve?.bind(ctx.container)) as undefined | (<T>(name: string) => T)
  if (!resolve) return null
  try {
    const em = resolve<{ fork: () => unknown }>('em')
    let cache: unknown = null
    try {
      cache = resolve<unknown>('cache')
    } catch {
      cache = null
    }
    type AccessServiceModule = typeof import('@open-mercato/core/modules/subscriptions/lib/access-service')
    const mod: AccessServiceModule = await import(
      '@open-mercato/core/modules/subscriptions/lib/access-service'
    )
    const snapshot = await mod.computeAccessSnapshotCached({
      em: em as never,
      cache: cache as never,
      scope,
      externalAccountId,
      productCode,
    })
    return snapshot?.entitlements ?? null
  } catch (error) {
    console.warn('[onboarding_bridge] failed to load entitlements snapshot', error)
    return null
  }
}

export default async function handler(payload: AccessChangedPayload, ctx: Ctx): Promise<void> {
  const config = readConfig()
  if (!config) return

  const entitlements = await loadEntitlements(
    ctx,
    { tenantId: payload.tenantId, organizationId: payload.organizationId },
    payload.externalAccountId,
    config.productCode,
  )

  const body = JSON.stringify({
    externalAccountId: payload.externalAccountId,
    productCode: config.productCode,
    accessState: payload.accessState,
    subscriptionId: payload.subscriptionId,
    entitlements,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
    providerStatus: payload.providerStatus,
    occurredAt: new Date().toISOString(),
  })
  const signature = createHmac('sha256', config.secret).update(body).digest('hex')
  const deliveryId = `om-${payload.subscriptionId}-${payload.accessState}-${Date.now()}`

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-om-webhook-signature': signature,
      'x-om-webhook-delivery-id': deliveryId,
    },
    body,
  }).catch((error) => {
    console.warn('[onboarding_bridge] forward failed (network)', error)
    return null
  })

  if (!response) {
    // Persistent subscriber will be retried by the events runtime
    throw new Error('onboarding_bridge: webhook delivery failed (network)')
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn('[onboarding_bridge] forward returned non-2xx', response.status, text.slice(0, 200))
    throw new Error(`onboarding_bridge: webhook delivery returned ${response.status}`)
  }
}
