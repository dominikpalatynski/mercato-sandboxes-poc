import { readEntitlementsView } from '@/lib/openmercato-subscriptions';

export const SANDBOX_QUOTA_COUNTED_STATUSES = ['building', 'ready', 'stopped'] as const;

export const SANDBOX_QUOTA_ERROR_CODES = {
  SANDBOX_LIMIT_REACHED: 'sandbox_limit_reached',
  SANDBOX_QUOTA_UNAVAILABLE: 'sandbox_quota_unavailable',
} as const;

export interface SandboxQuota {
  limit: number | null;
  used: number;
  remaining: number | null;
  reached: boolean;
  valid: boolean;
  countedStatuses: string[];
}

export class SandboxQuotaError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly quota: SandboxQuota,
  ) {
    super(message);
    this.name = 'SandboxQuotaError';
  }
}

export function readSandboxQuotaLimit(
  entitlements: Record<string, unknown> | null | undefined,
): number | null {
  const { sandboxCount } = readEntitlementsView(entitlements);
  if (typeof sandboxCount !== 'number' || !Number.isInteger(sandboxCount) || sandboxCount < 0) {
    return null;
  }
  return sandboxCount;
}

export function buildSandboxQuota(
  entitlements: Record<string, unknown> | null | undefined,
  used: number,
): SandboxQuota {
  const normalizedUsed = Number.isFinite(used) ? Math.max(0, Math.trunc(used)) : 0;
  const limit = readSandboxQuotaLimit(entitlements);
  const remaining = limit === null ? null : Math.max(limit - normalizedUsed, 0);

  return {
    limit,
    used: normalizedUsed,
    remaining,
    reached: limit !== null && normalizedUsed >= limit,
    valid: limit !== null,
    countedStatuses: [...SANDBOX_QUOTA_COUNTED_STATUSES],
  };
}

export function assertSandboxQuotaAvailable(quota: SandboxQuota): void {
  if (!quota.valid) {
    throw new SandboxQuotaError(
      409,
      SANDBOX_QUOTA_ERROR_CODES.SANDBOX_QUOTA_UNAVAILABLE,
      'Your current plan does not expose a valid sandbox limit.',
      quota,
    );
  }

  if (quota.reached) {
    throw new SandboxQuotaError(
      409,
      SANDBOX_QUOTA_ERROR_CODES.SANDBOX_LIMIT_REACHED,
      'Sandbox limit reached for your current plan.',
      quota,
    );
  }
}
