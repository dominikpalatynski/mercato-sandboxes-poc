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

async function k8sFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
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

export interface MirrorJobInput {
  sandboxId: string;
  /** Gitea HTTPS clone URL with embedded credentials. */
  sourceUrlWithCreds: string;
  /** GitHub HTTPS clone URL WITHOUT credentials — token goes in `targetToken`. */
  targetUrl: string;
  /**
   * GitHub installation access token. Lives ~1h; the Job uses it once and
   * then it is discarded with the Secret.
   */
  targetToken: string;
}

/**
 * Spawn a one-shot Kubernetes Job that mirrors the Gitea repo to GitHub
 * (full history, all refs). Returns the job name; callers should poll its
 * status separately if they need to wait.
 *
 * The Job is named deterministically from the sandbox UUID so a retry of a
 * crashed migration finds the previous attempt and treats AlreadyExists as
 * a no-op.
 */
export async function spawnGitMirrorJob(input: MirrorJobInput): Promise<{ jobName: string }> {
  const jobName = `mercato-mirror-${input.sandboxId.toLowerCase()}`;
  const targetUrl = new URL(input.targetUrl);
  // GitHub accepts `x-access-token:<token>` as basic auth for App tokens.
  targetUrl.username = 'x-access-token';
  targetUrl.password = input.targetToken;
  const targetWithCreds = targetUrl.toString();

  const body = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      labels: {
        'app.kubernetes.io/part-of': 'mercato-sandboxes',
        'app.kubernetes.io/component': 'github-mirror',
        'mercato.sandbox/id': input.sandboxId,
      },
    },
    spec: {
      backoffLimit: 2,
      ttlSecondsAfterFinished: 3600,
      template: {
        spec: {
          restartPolicy: 'Never',
          nodeSelector: { 'node-pool': 'system' },
          tolerations: [
            { key: 'dedicated', operator: 'Equal', value: 'system', effect: 'NoSchedule' },
          ],
          containers: [
            {
              name: 'mirror',
              image: 'alpine/git:2.45.2',
              command: ['sh', '-c'],
              args: [
                [
                  'set -e',
                  'cd /tmp',
                  'rm -rf mirror.git',
                  'git clone --mirror "$SRC_URL" mirror.git',
                  'cd mirror.git',
                  'git remote set-url --push origin "$DST_URL"',
                  'git push --mirror origin',
                ].join(' && '),
              ],
              env: [
                { name: 'SRC_URL', value: input.sourceUrlWithCreds },
                { name: 'DST_URL', value: targetWithCreds },
              ],
              resources: {
                requests: { cpu: '100m', memory: '256Mi' },
                limits: { cpu: '500m', memory: '512Mi' },
              },
            },
          ],
        },
      },
    },
  };

  try {
    await k8sFetch(`/apis/batch/v1/namespaces/${NAMESPACE}/jobs`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Treat AlreadyExists as success — a retried migration will reuse the
    // existing Job and the caller can poll its status.
    if (!(e instanceof Error) || !/failed: 409/.test(e.message)) throw e;
  }
  return { jobName };
}

export async function deleteJob(jobName: string): Promise<void> {
  try {
    await k8sFetch(
      `/apis/batch/v1/namespaces/${NAMESPACE}/jobs/${jobName}?propagationPolicy=Foreground`,
      { method: 'DELETE' },
    );
  } catch (e) {
    if (e instanceof Error && /failed: 404/.test(e.message)) return;
    throw e;
  }
}

export interface JobStatus {
  active: number;
  succeeded: number;
  failed: number;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export async function getJobStatus(jobName: string): Promise<JobStatus | null> {
  try {
    const job = await k8sFetch<{ status?: JobStatus }>(
      `/apis/batch/v1/namespaces/${NAMESPACE}/jobs/${jobName}`,
    );
    return job.status ?? { active: 0, succeeded: 0, failed: 0, conditions: [] };
  } catch (e) {
    if (e instanceof Error && /failed: 404/.test(e.message)) return null;
    throw e;
  }
}
