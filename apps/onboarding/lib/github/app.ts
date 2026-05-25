import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';

const GITHUB_API_URL = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

function appId(): string {
  const v = process.env.GITHUB_APP_ID;
  if (!v) throw new Error('GITHUB_APP_ID not set');
  return v;
}

function appSlug(): string {
  const v = process.env.GITHUB_APP_SLUG;
  if (!v) throw new Error('GITHUB_APP_SLUG not set');
  return v;
}

function privateKeyPem(): string {
  const path = process.env.GITHUB_APP_PRIVATE_KEY_FILE;
  if (!path) throw new Error('GITHUB_APP_PRIVATE_KEY_FILE not set');
  return readFileSync(path, 'utf8');
}

function webhookSecret(): string {
  const v = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!v) throw new Error('GITHUB_APP_WEBHOOK_SECRET not set');
  return v;
}

export class GitHubApiError extends Error {
  constructor(public readonly status: number, public readonly body: string, message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/**
 * Mint a short-lived (10 minute) App JWT used to call GitHub App-level
 * endpoints — primarily /app/installations/{id}/access_tokens. The token is
 * NOT cached because the issuance cost is negligible compared to the
 * round-trip needed when we exchange it.
 */
export async function mintAppJwt(): Promise<string> {
  const key = await importPKCS8(privateKeyPem(), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 30) // tolerate small clock drift
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId())
    .sign(key);
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

/**
 * Exchange the App JWT for an installation access token (~1h validity).
 * Tokens are not refreshed automatically — callers that need long-lived
 * access are expected to mint a new one for each migration job. The plan
 * accepts this for MVP because the handover Job uses the token once.
 */
export async function mintInstallationToken(installationId: string): Promise<InstallationToken> {
  const jwt = await mintAppJwt();
  const res = await fetch(`${GITHUB_API_URL}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(res.status, body, `GitHub installation token mint failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  return { token: json.token, expiresAt: json.expires_at };
}

export interface GitHubRepoRef {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
}

/**
 * Create a private repository on behalf of the installation. If the user
 * installed the app on their personal account, the repo lands under that
 * user; if installed on an org, it lands in the org.
 */
export async function createInstallationRepo(input: {
  installationToken: string;
  owner: string;
  ownerType: 'user' | 'org';
  name: string;
  description?: string;
}): Promise<GitHubRepoRef> {
  const path =
    input.ownerType === 'org'
      ? `/orgs/${encodeURIComponent(input.owner)}/repos`
      : '/user/repos';
  const res = await fetch(`${GITHUB_API_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.installationToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? 'Mercato sandbox workspace',
      private: true,
      auto_init: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(res.status, body, `GitHub repo create failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { full_name: string; clone_url: string; default_branch?: string };
  return {
    fullName: json.full_name,
    cloneUrl: json.clone_url,
    defaultBranch: json.default_branch ?? 'main',
  };
}

export interface InstallationLookup {
  id: number;
  account: {
    login: string;
    type: 'User' | 'Organization';
  };
}

export async function getInstallation(installationId: string): Promise<InstallationLookup> {
  const jwt = await mintAppJwt();
  const res = await fetch(`${GITHUB_API_URL}/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(res.status, body, `GitHub get-installation failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as InstallationLookup;
}

/**
 * Verify an inbound webhook delivery's `X-Hub-Signature-256` header.
 * Returns true if the signature matches the configured webhook secret.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
  // timingSafeEqual requires equal-length buffers.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

export function appInstallUrl(): string {
  return `https://github.com/apps/${encodeURIComponent(appSlug())}/installations/new`;
}
