import { readFileSync } from 'node:fs';

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const NAMESPACE =
  process.env.WORKSPACE_NAMESPACE ||
  safeRead('/var/run/secrets/kubernetes.io/serviceaccount/namespace') ||
  'mercato-sandboxes';

const API_BASE = (() => {
  if (process.env.KUBERNETES_API_URL) return process.env.KUBERNETES_API_URL.replace(/\/$/, '');
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  if (host) return `https://${host}:${port}`;
  return 'https://kubernetes.default.svc';
})();

function token(): string {
  const t = safeRead('/var/run/secrets/kubernetes.io/serviceaccount/token');
  if (!t) throw new Error('Kubernetes service-account token not available');
  return t;
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function fromB64(s: string | undefined): string | null {
  if (!s) return null;
  const value = Buffer.from(s, 'base64').toString('utf8');
  return value || null;
}

// The in-cluster API server presents a cert signed by the cluster's own CA.
// The onboarding deployment sets NODE_EXTRA_CA_CERTS to
// /var/run/secrets/kubernetes.io/serviceaccount/ca.crt so the global fetch
// already trusts that chain — no per-request dispatcher needed.
async function k8sFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': init?.method === 'PATCH' ? 'application/strategic-merge-patch+json' : 'application/json',
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Kubernetes API ${init?.method || 'GET'} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export function workspaceCredsSecretName(sandboxId: string): string {
  // Kubernetes names cap at 253 chars and are DNS-1123. UUIDs satisfy that.
  return `mercato-workspace-creds-${sandboxId.toLowerCase()}`;
}

export interface WorkspaceCredsEnv {
  MERCATO_REPO_URL: string;
  MERCATO_REPO_TOKEN: string;
  MERCATO_GH_USER_NAME?: string;
  MERCATO_GH_USER_EMAIL?: string;
}

export interface WorkspaceBillingEnv {
  OPENROUTER_API_KEY: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

/**
 * Create-or-update the Kubernetes Secret consumed by the workspace pod's
 * `envFrom`. Idempotent: PATCH if it already exists.
 *
 * The Secret holds a single git deploy token plus the optional Co-Authored-By
 * hints. Billing may later patch the same Secret with the per-sandbox
 * OpenRouter env vars consumed by Codex/Claude.
 */
export async function upsertWorkspaceCredsSecret(
  sandboxId: string,
  env: WorkspaceCredsEnv,
): Promise<{ name: string }> {
  const name = workspaceCredsSecretName(sandboxId);
  const data: Record<string, string> = {
    MERCATO_REPO_URL: b64(env.MERCATO_REPO_URL),
    MERCATO_REPO_TOKEN: b64(env.MERCATO_REPO_TOKEN),
  };
  if (env.MERCATO_GH_USER_NAME) data.MERCATO_GH_USER_NAME = b64(env.MERCATO_GH_USER_NAME);
  if (env.MERCATO_GH_USER_EMAIL) data.MERCATO_GH_USER_EMAIL = b64(env.MERCATO_GH_USER_EMAIL);

  const body = {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: {
      name,
      labels: {
        'app.kubernetes.io/part-of': 'mercato-sandboxes',
        'app.kubernetes.io/component': 'workspace-credentials',
        'mercato.sandbox/id': sandboxId,
      },
    },
    data,
  };

  try {
    await k8sFetch(`/api/v1/namespaces/${NAMESPACE}/secrets`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { name };
  } catch (e) {
    if (!(e instanceof Error) || !/failed: 409/.test(e.message)) throw e;
    await k8sFetch(`/api/v1/namespaces/${NAMESPACE}/secrets/${name}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
    return { name };
  }
}

export async function getWorkspaceBillingSecrets(
  secretName: string,
): Promise<WorkspaceBillingEnv | null> {
  try {
    const secret = await k8sFetch<{ data?: Record<string, string> }>(
      `/api/v1/namespaces/${NAMESPACE}/secrets/${secretName}`,
    );
    const openRouterKey = fromB64(secret.data?.OPENROUTER_API_KEY);
    if (!openRouterKey) return null;
    return {
      OPENROUTER_API_KEY: openRouterKey,
      ANTHROPIC_AUTH_TOKEN: fromB64(secret.data?.ANTHROPIC_AUTH_TOKEN) ?? openRouterKey,
    };
  } catch (e) {
    if (e instanceof Error && /failed: 404/.test(e.message)) return null;
    throw e;
  }
}

export async function upsertWorkspaceBillingSecrets(
  secretName: string,
  env: WorkspaceBillingEnv,
): Promise<void> {
  await k8sFetch(`/api/v1/namespaces/${NAMESPACE}/secrets/${secretName}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        OPENROUTER_API_KEY: b64(env.OPENROUTER_API_KEY),
        ANTHROPIC_AUTH_TOKEN: b64(env.ANTHROPIC_AUTH_TOKEN ?? env.OPENROUTER_API_KEY),
      },
    }),
  });
}

export async function deleteWorkspaceCredsSecret(sandboxId: string): Promise<void> {
  const name = workspaceCredsSecretName(sandboxId);
  try {
    await k8sFetch(`/api/v1/namespaces/${NAMESPACE}/secrets/${name}`, { method: 'DELETE' });
  } catch (e) {
    if (e instanceof Error && /failed: 404/.test(e.message)) return;
    throw e;
  }
}
