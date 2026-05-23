import { BILLING_ERROR_CODES } from '@/lib/om-billing';

export type OpenRouterLimitReset = 'daily' | 'weekly' | 'monthly' | null;

export interface OpenRouterApiKeyRecord {
  hash: string;
  label: string;
  name: string | null;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: OpenRouterLimitReset;
  usage: number;
  usage_monthly: number;
  disabled: boolean;
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
}

export interface OpenRouterCreatedKey extends OpenRouterApiKeyRecord {
  key: string;
}

export interface CreateOpenRouterKeyInput {
  name: string;
  limit: number | null;
  limit_reset: OpenRouterLimitReset;
}

export interface UpdateOpenRouterKeyInput {
  name?: string;
  limit?: number | null;
  limit_reset?: OpenRouterLimitReset;
  disabled?: boolean;
}

export class OpenRouterApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterApiError';
  }
}

function baseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
}

function managementKey(): string {
  const key = process.env.OPENROUTER_MANAGEMENT_KEY || process.env.OPENROUTER_MANAGEMENT_API_KEY;
  if (!key) {
    throw new Error(BILLING_ERROR_CODES.PROVIDER_CONFIGURATION_MISSING);
  }
  return key;
}

function mapKeyRecord(raw: Record<string, unknown>): OpenRouterApiKeyRecord {
  return {
    hash: String(raw.hash || ''),
    label: String(raw.label || raw.name || ''),
    name: typeof raw.name === 'string' ? raw.name : null,
    limit: raw.limit == null ? null : Number(raw.limit),
    limit_remaining: raw.limit_remaining == null ? null : Number(raw.limit_remaining),
    limit_reset: (raw.limit_reset as OpenRouterLimitReset | undefined) ?? null,
    usage: Number(raw.usage || 0),
    usage_monthly: Number(raw.usage_monthly || 0),
    disabled: Boolean(raw.disabled),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    expires_at: typeof raw.expires_at === 'string' ? raw.expires_at : null,
  };
}

async function openRouterFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${managementKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OpenRouterApiError(
      res.status,
      body,
      `OpenRouter ${init?.method || 'GET'} ${path} failed: ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}

export function buildOpenRouterKeyName(userId: string): string {
  return `open-mercato-${userId}`;
}

export async function listOpenRouterKeys(includeDisabled = false): Promise<OpenRouterApiKeyRecord[]> {
  const query = includeDisabled ? '?include_disabled=true' : '';
  const response = await openRouterFetch<{ data: Record<string, unknown>[] }>(`/keys${query}`);
  return response.data.map(mapKeyRecord);
}

export async function findOpenRouterKeyByName(
  name: string,
): Promise<OpenRouterApiKeyRecord | null> {
  const keys = await listOpenRouterKeys(true);
  return keys.find((key) => key.name === name) ?? null;
}

export async function createOpenRouterKey(
  input: CreateOpenRouterKeyInput,
): Promise<OpenRouterCreatedKey> {
  const response = await openRouterFetch<{ data: Record<string, unknown> & { key: unknown } }>(
    '/keys',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        limit: input.limit,
        limit_reset: input.limit_reset,
      }),
    },
  );

  return {
    ...mapKeyRecord(response.data),
    key: String(response.data.key || ''),
  };
}

export async function getOpenRouterKey(hash: string): Promise<OpenRouterApiKeyRecord> {
  const response = await openRouterFetch<{ data: Record<string, unknown> }>(
    `/keys/${encodeURIComponent(hash)}`,
  );
  return mapKeyRecord(response.data);
}

export async function updateOpenRouterKey(
  hash: string,
  input: UpdateOpenRouterKeyInput,
): Promise<OpenRouterApiKeyRecord> {
  const response = await openRouterFetch<{ data: Record<string, unknown> }>(
    `/keys/${encodeURIComponent(hash)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return mapKeyRecord(response.data);
}

export async function disableOpenRouterKey(hash: string): Promise<OpenRouterApiKeyRecord> {
  return updateOpenRouterKey(hash, { disabled: true });
}

export async function deleteOpenRouterKey(hash: string): Promise<void> {
  await openRouterFetch(`/keys/${encodeURIComponent(hash)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}
