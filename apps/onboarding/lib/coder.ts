import 'server-only';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const CODER_URL = (process.env.CODER_URL || 'http://coder:7080').replace(/\/$/, '');
const CODER_PUBLIC_URL = (process.env.CODER_PUBLIC_URL || 'http://localhost:7080').replace(/\/$/, '');
const CODER_ADMIN_TOKEN_FILE = process.env.CODER_ADMIN_TOKEN_FILE || '/run/secrets/coder-admin-token';
const CODER_TEMPLATE_ID_FILE = process.env.CODER_TEMPLATE_ID_FILE || '/run/secrets/coder-template-id';

function readTrim(path: string, label: string): string {
  try {
    const v = readFileSync(path, 'utf8').trim();
    if (!v) throw new Error(`${label} file is empty: ${path}`);
    return v;
  } catch (e) {
    throw new Error(`Failed to read ${label} from ${path}: ${(e as Error).message}`);
  }
}

// Lazy reads — Next.js executes route modules at build time during "Collecting
// page data". We don't want to fail the build if the secret files are missing
// in that environment; only fail the first time a route actually calls Coder.
let _adminToken: string | null = null;
let _templateId: string | null = null;
function adminToken(): string {
  if (_adminToken === null) _adminToken = readTrim(CODER_ADMIN_TOKEN_FILE, 'Coder admin token');
  return _adminToken;
}
function templateId(): string {
  if (_templateId === null) _templateId = readTrim(CODER_TEMPLATE_ID_FILE, 'Coder template id');
  return _templateId;
}

export const coderPublicUrl = CODER_PUBLIC_URL;

export interface CoderUserRef {
  id: string;
  username: string;
  tempPassword: string;
}

export interface CoderWorkspaceRef {
  id: string;
}

export interface WorkspaceApp {
  slug: string;
  display_name: string;
  url: string;
  external: boolean;
}

export interface CoderWorkspaceStatus {
  jobStatus: string;            // pending|running|succeeded|failed|canceled
  transition: string;           // start|stop|delete
  agentStatus: string | null;
  lifecycleState: string | null;
  ownerName: string;
  name: string;
  apps: WorkspaceApp[];
  agentId: string | null;
  latestBuildId: string | null;
}

export interface AgentMetadataItem {
  key: string;
  display_name: string;
  value: string;
  collected_at: string | null;
  age_seconds: number | null;
}

export interface CoderWorkspaceMetadata {
  cpu: AgentMetadataItem | null;
  memory: AgentMetadataItem | null;
  diskHome: AgentMetadataItem | null;
  agentStatus: string | null;
  lifecycleState: string | null;
}

export interface CoderLogLine {
  id: number;
  created_at: string;
  log_level: string;
  log_source?: string;
  output: string;
  stage?: string;
}

export interface CoderLinks {
  vscode: string;
  splash: string;
  app: string;
  terminal: string;
}

export class CoderApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
    this.name = 'CoderApiError';
  }
}

export async function coderFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CODER_URL}${path}`, {
    ...init,
    headers: {
      'Coder-Session-Token': adminToken(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new CoderApiError(res.status, text, `Coder API ${init?.method || 'GET'} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  // Some endpoints (e.g. delete) might be empty
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined as unknown as T;
  }
  return res.json() as Promise<T>;
}

let cachedOrgId: string | null = null;
async function getOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const me = await coderFetch<{ organization_ids: string[] }>('/api/v2/users/me');
  if (!me.organization_ids || me.organization_ids.length === 0) {
    throw new Error('Coder admin user has no organizations');
  }
  cachedOrgId = me.organization_ids[0]!;
  return cachedOrgId;
}

function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] || '';
  let u = local.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (u.length > 32) u = u.slice(0, 32).replace(/-+$/g, '');
  if (!u) u = 'user';
  return u;
}

function generateTempPassword(): string {
  return randomBytes(12).toString('base64url').slice(0, 16);
}

function randomSuffix(): string {
  return randomBytes(3).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 4) || 'x';
}

export async function ensureCoderUser(email: string): Promise<CoderUserRef> {
  const orgId = await getOrgId();
  const tempPassword = generateTempPassword();
  let baseUsername = usernameFromEmail(email);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const username = attempt === 0 ? baseUsername : `${baseUsername.slice(0, 27)}-${randomSuffix()}`;
    try {
      const body = {
        email,
        username,
        name: email,
        password: tempPassword,
        organization_ids: [orgId],
        login_type: 'password',
        user_status: 'active',
      };
      const created = await coderFetch<{ id: string; username: string }>('/api/v2/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { id: created.id, username: created.username, tempPassword };
    } catch (e) {
      lastErr = e;
      if (e instanceof CoderApiError) {
        const taken = e.status === 409 || (e.status === 400 && /already taken|exists|in use/i.test(e.body));
        if (taken) continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Failed to create Coder user after retries');
}

export async function createWorkspace(coderUserId: string, name: string): Promise<CoderWorkspaceRef> {
  const orgId = await getOrgId();
  const body = {
    name,
    template_id: templateId(),
    rich_parameter_values: [],
    automatic_updates: 'never',
  };
  const created = await coderFetch<{ id: string }>(
    `/api/v2/organizations/${orgId}/members/${coderUserId}/workspaces`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return { id: created.id };
}

interface RawWorkspaceApp {
  slug: string;
  display_name: string;
  url?: string;
  external?: boolean;
}

interface RawAgentMetadataItem {
  result?: {
    collected_at?: string;
    age?: number;
    value?: string;
    error?: string;
  };
  description?: {
    display_name?: string;
    key?: string;
    script?: string;
    interval?: number;
    timeout?: number;
  };
}

interface RawAgent {
  id: string;
  status: string;
  lifecycle_state: string;
  apps?: RawWorkspaceApp[];
}

interface RawWorkspace {
  name: string;
  owner_name: string;
  latest_build: {
    id: string;
    transition: string;
    job: { status: string };
    resources?: Array<{
      agents?: RawAgent[];
    }>;
  };
}

export async function getWorkspaceStatus(id: string): Promise<CoderWorkspaceStatus> {
  const ws = await coderFetch<RawWorkspace>(`/api/v2/workspaces/${id}`);
  const agents = (ws.latest_build.resources ?? []).flatMap((r) => r.agents ?? []);
  const agent = agents[0];
  const rawApps = (agents.flatMap((a) => a.apps ?? []) as RawWorkspaceApp[]) || [];
  const apps: WorkspaceApp[] = rawApps.map((a) => ({
    slug: a.slug,
    display_name: a.display_name,
    url: a.url ?? '',
    external: a.external === true,
  }));
  return {
    jobStatus: ws.latest_build.job.status,
    transition: ws.latest_build.transition,
    agentStatus: agent?.status ?? null,
    lifecycleState: agent?.lifecycle_state ?? null,
    ownerName: ws.owner_name,
    name: ws.name,
    apps,
    agentId: agent?.id ?? null,
    latestBuildId: ws.latest_build.id ?? null,
  };
}

interface RawWorkspaceWithMetadata {
  latest_build: {
    transition: string;
    job: { status: string };
    resources?: Array<{
      agents?: Array<RawAgent & { metadata?: RawAgentMetadataItem[] }>;
    }>;
  };
}

function pickMetadata(
  metadata: RawAgentMetadataItem[] | undefined,
  key: string,
): AgentMetadataItem | null {
  if (!metadata) return null;
  const item = metadata.find((m) => m.description?.key === key);
  if (!item) return null;
  return {
    key,
    display_name: item.description?.display_name ?? key,
    value: item.result?.value ?? '',
    collected_at: item.result?.collected_at ?? null,
    age_seconds: typeof item.result?.age === 'number' ? item.result.age : null,
  };
}

export async function getWorkspaceMetadata(id: string): Promise<CoderWorkspaceMetadata> {
  const ws = await coderFetch<RawWorkspaceWithMetadata>(`/api/v2/workspaces/${id}`);
  const agents = (ws.latest_build.resources ?? []).flatMap((r) => r.agents ?? []);
  const agent = agents[0];
  const md = (agent as (RawAgent & { metadata?: RawAgentMetadataItem[] }) | undefined)?.metadata;
  return {
    cpu: pickMetadata(md, 'cpu'),
    memory: pickMetadata(md, 'memory'),
    diskHome: pickMetadata(md, 'disk_home'),
    agentStatus: agent?.status ?? null,
    lifecycleState: agent?.lifecycle_state ?? null,
  };
}

export async function getBuildLogs(buildId: string, after = 0): Promise<CoderLogLine[]> {
  return coderFetch<CoderLogLine[]>(`/api/v2/workspacebuilds/${buildId}/logs?after=${after}`);
}

export async function getAgentLogs(agentId: string, after = 0): Promise<CoderLogLine[]> {
  return coderFetch<CoderLogLine[]>(`/api/v2/workspaceagents/${agentId}/logs?after=${after}`);
}

export async function cancelWorkspaceBuild(buildId: string): Promise<void> {
  await coderFetch(`/api/v2/workspacebuilds/${buildId}/cancel`, { method: 'PATCH' });
}

/**
 * Resolve the user-facing URL for a given app slug from a workspace's apps list.
 * - external apps: use the upstream `url` directly (e.g. http://localhost:30123).
 * - non-external apps: build the path-based proxy URL via Coder.
 * Returns null if the slug is missing entirely.
 */
export function resolveAppUrl(args: {
  apps: WorkspaceApp[];
  slug: string;
  coderPublicUrl: string;
  ownerName: string;
  name: string;
}): string | null {
  const app = args.apps.find((a) => a.slug === args.slug);
  if (!app) return null;
  if (app.external && app.url) return app.url;
  const base = `${args.coderPublicUrl.replace(/\/$/, '')}/@${args.ownerName}/${args.name}`;
  return `${base}/apps/${args.slug}`;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await coderFetch(`/api/v2/workspaces/${id}/builds`, {
    method: 'POST',
    body: JSON.stringify({ transition: 'delete', orphan: false }),
  });
}

export function buildLinks(args: {
  coderPublicUrl: string;
  ownerName: string;
  name: string;
}): CoderLinks {
  const base = `${args.coderPublicUrl.replace(/\/$/, '')}/@${args.ownerName}/${args.name}`;
  return {
    vscode: `${base}/apps/code-server`,
    splash: `${base}/apps/splash`,
    app: `${base}/apps/app`,
    terminal: `${base}/terminal`,
  };
}
