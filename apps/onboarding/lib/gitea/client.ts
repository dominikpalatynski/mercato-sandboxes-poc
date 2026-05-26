import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

const GITEA_API_URL = (process.env.GITEA_API_URL || 'http://gitea-http.gitea.svc.cluster.local:3000').replace(/\/$/, '');
const GITEA_PUBLIC_URL = (process.env.GITEA_PUBLIC_URL || 'https://gitea.sandbox.palatynskicloud.com').replace(/\/$/, '');

function adminTokenFile(): string {
  return process.env.GITEA_ADMIN_TOKEN_FILE || '/run/secrets/gitea-admin/token';
}

let _adminToken: string | null = null;
function adminToken(): string {
  if (_adminToken !== null) return _adminToken;
  try {
    const v = readFileSync(adminTokenFile(), 'utf8').trim();
    if (!v) throw new Error(`Gitea admin token file is empty: ${adminTokenFile()}`);
    _adminToken = v;
    return v;
  } catch (e) {
    throw new Error(`Failed to read Gitea admin token from ${adminTokenFile()}: ${(e as Error).message}`);
  }
}

export const giteaPublicUrl = GITEA_PUBLIC_URL;

export class GiteaApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
    this.name = 'GiteaApiError';
  }
}

async function giteaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITEA_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${adminToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GiteaApiError(
      res.status,
      body,
      `Gitea API ${init?.method || 'GET'} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export interface GiteaOrgRef {
  name: string;
  id: number;
}

export interface GiteaRepoRef {
  name: string;
  fullName: string;
  cloneUrl: string;
  sshUrl: string;
}

export interface GiteaRepoToken {
  id: number;
  name: string;
  /**
   * Raw token. Gitea only returns this once at creation time — store it in
   * the workspace-credentials Secret immediately.
   */
  sha1: string;
}

function buildOrgName(email: string, userId: string): string {
  // Gitea owner names: <=40 chars, [a-zA-Z0-9._-], can't start with `-`.
  // Use the email local-part as the human-readable base and an HMAC(userId)
  // suffix so two users sharing a local-part still get distinct, deterministic
  // org names. Falls back to `user` if the local-part has no usable chars.
  const local = (email.split('@')[0] || '').toLowerCase();
  const baseRaw = local.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const base = baseRaw || 'user';
  const suffix = createHmac('sha256', 'mercato-gitea-org')
    .update(userId)
    .digest('hex')
    .slice(0, 4);
  return `${base}-${suffix}`;
}

function isAlreadyExistsError(error: unknown): error is GiteaApiError {
  if (!(error instanceof GiteaApiError)) return false;
  if (error.status === 409) return true;
  return error.status === 422 && /already exists|already taken|in use|exists/i.test(error.body);
}

async function getUserOwner(username: string): Promise<GiteaOrgRef> {
  const user = await giteaFetch<{ id: number; username: string }>(
    `/api/v1/users/${encodeURIComponent(username)}`,
  );
  return { name: user.username, id: user.id };
}

function passwordForOwner(ownerName: string): string {
  // /users/{username}/tokens only accepts Basic auth as that user. Keep a
  // deterministic high-entropy password so retries can mint fresh repo tokens.
  return `mc_${createHmac('sha256', adminToken()).update(ownerName).digest('base64url').slice(0, 40)}`;
}

async function setOwnerPassword(ownerName: string): Promise<string> {
  const password = passwordForOwner(ownerName);
  await giteaFetch(`/api/v1/admin/users/${encodeURIComponent(ownerName)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source_id: 0,
      login_name: ownerName,
      password,
      must_change_password: false,
      active: true,
    }),
  });
  return password;
}

async function giteaUserFetch<T>(
  username: string,
  password: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return giteaFetch<T>(path, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      ...(init?.headers || {}),
    },
  });
}

/**
 * Idempotently provision a personal repository owner for a Mercato user inside
 * Gitea. Returns the owner slug; the caller persists it on the users row.
 *
 * User and organization names share one namespace in Gitea, so we keep the
 * repository owner as a backing user. That lets us mint per-owner access tokens
 * and create user-owned repositories without colliding with an organization of
 * the same name.
 */
export async function createUserOrg(input: {
  userId: string;
  email: string;
  fullName?: string;
}): Promise<GiteaOrgRef> {
  const giteaUsername = buildOrgName(input.email, input.userId);

  try {
    const created = await giteaFetch<{ id: number; username: string }>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: giteaUsername,
        email: input.email,
        password: passwordForOwner(giteaUsername),
        full_name: input.fullName ?? '',
        must_change_password: false,
        send_notify: false,
      }),
    });
    return { name: created.username, id: created.id };
  } catch (e) {
    if (!isAlreadyExistsError(e)) {
      throw e;
    }
    return getUserOwner(giteaUsername);
  }
}

function sanitizeRepoName(projectId: string): string {
  // Gitea allows alphanumerics, _, -, and .; clamp to 100 chars.
  const cleaned = projectId.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, 100);
  return trimmed.length > 0 ? trimmed : `repo-${randomBytes(3).toString('hex')}`;
}

/**
 * Create a new repository inside the given org. If it already exists this
 * returns the existing repo's clone URLs so a partially failed sandbox
 * create can be retried without a 409.
 */
export async function createRepo(orgName: string, projectId: string): Promise<GiteaRepoRef> {
  const repoName = sanitizeRepoName(projectId);
  try {
    const repo = await giteaFetch<{ name: string; full_name: string; clone_url: string; ssh_url: string }>(
      `/api/v1/admin/users/${encodeURIComponent(orgName)}/repos`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: repoName,
          private: true,
          auto_init: true,
          default_branch: 'main',
          description: 'Mercato sandbox workspace',
        }),
      },
    );
    return {
      name: repo.name,
      fullName: repo.full_name,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    };
  } catch (e) {
    if (e instanceof GiteaApiError && (e.status === 409 || e.status === 422)) {
      const existing = await giteaFetch<{ name: string; full_name: string; clone_url: string; ssh_url: string }>(
        `/api/v1/repos/${encodeURIComponent(orgName)}/${encodeURIComponent(repoName)}`,
      );
      return {
        name: existing.name,
        fullName: existing.full_name,
        cloneUrl: existing.clone_url,
        sshUrl: existing.ssh_url,
      };
    }
    throw e;
  }
}

/**
 * Mint a repo-scoped deploy token with write:repository. Gitea returns the
 * raw token (`sha1`) only once at creation — the caller must persist it into
 * the per-workspace Secret immediately.
 */
export async function createRepoDeployToken(
  orgName: string,
  repoName: string,
): Promise<GiteaRepoToken> {
  // Gitea's per-repo "deploy tokens" via /api/v1/repos/{owner}/{repo}/keys are
  // SSH keys, not HTTPS access tokens. /users/{user}/tokens requires Basic auth
  // as that user, so reset the deterministic backing-user password first.
  const name = `mercato-${repoName}-${randomBytes(3).toString('hex')}`;
  const password = await setOwnerPassword(orgName);
  const token = await giteaUserFetch<{ id: number; name: string; sha1: string }>(
    orgName,
    password,
    `/api/v1/users/${encodeURIComponent(orgName)}/tokens`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        scopes: ['write:repository'],
      }),
    },
  );
  return { id: token.id, name: token.name, sha1: token.sha1 };
}

/**
 * Archive (not delete) a repo. Used during GitHub handover so the old Gitea
 * URL keeps working for forensics but no new commits land there.
 */
export async function archiveRepo(orgName: string, repoName: string): Promise<void> {
  await giteaFetch(`/api/v1/repos/${encodeURIComponent(orgName)}/${encodeURIComponent(repoName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

export { buildOrgName, passwordForOwner, setOwnerPassword };
