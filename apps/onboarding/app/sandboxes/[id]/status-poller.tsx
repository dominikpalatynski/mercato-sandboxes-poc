'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SandboxView {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
}

interface Props {
  initial: SandboxView;
  coderEmail: string;
  coderTempPassword: string | null;
}

const POLL_INTERVAL_MS = 3_000;

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'failed':
      return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'building':
    case 'pending':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    default:
      return 'bg-white/10 text-gray-300 border-white/20';
  }
}

export default function StatusPoller({ initial, coderEmail, coderTempPassword }: Props) {
  const router = useRouter();
  const [sandbox, setSandbox] = useState<SandboxView>(initial);
  const [credsDismissed, setCredsDismissed] = useState<boolean>(false);
  const [deleting, setDeleting] = useState(false);
  const stoppedRef = useRef(false);

  // Local-storage flag so we don't keep nagging users about creds.
  useEffect(() => {
    try {
      const flag = window.localStorage.getItem(`sandbox-creds-dismissed:${initial.id}`);
      if (flag === '1') setCredsDismissed(true);
    } catch {
      /* ignore */
    }
  }, [initial.id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/sandboxes/${initial.id}/status`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as SandboxView;
          setSandbox(data);
          if (data.status === 'ready' || data.status === 'failed') {
            stoppedRef.current = true;
            return;
          }
        }
      } catch {
        /* swallow; will retry */
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    if (initial.status !== 'ready' && initial.status !== 'failed') {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [initial.id, initial.status]);

  const dismissCreds = useCallback(() => {
    try {
      window.localStorage.setItem(`sandbox-creds-dismissed:${initial.id}`, '1');
    } catch {
      /* ignore */
    }
    setCredsDismissed(true);
  }, [initial.id]);

  const onDeleteAndRetry = useCallback(async () => {
    setDeleting(true);
    try {
      await fetch(`/api/sandboxes/${initial.id}`, { method: 'DELETE' });
    } finally {
      router.push('/sandboxes/new');
    }
  }, [initial.id, router]);

  const links: Array<{ label: string; url: string | null }> = [
    { label: 'Open in VS Code', url: sandbox.vscode_url },
    { label: 'Open Terminal', url: sandbox.terminal_url },
    { label: 'Open App (port 3000)', url: sandbox.app_url },
    { label: 'Open Splash (port 4000)', url: sandbox.splash_url },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${statusBadgeClass(sandbox.status)}`}>
          {sandbox.status}
        </span>
        {sandbox.status === 'building' && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
        )}
        {sandbox.status_message && (
          <span className="text-sm text-gray-400">{sandbox.status_message}</span>
        )}
      </div>

      {sandbox.status === 'ready' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.url ?? '#'}
                target="_blank"
                rel="noopener"
                aria-disabled={!l.url}
                className={`flex items-center justify-center rounded-lg border px-4 py-4 text-center font-medium transition ${
                  l.url
                    ? 'border-indigo-400/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20'
                    : 'cursor-not-allowed border-white/10 bg-white/5 text-gray-500'
                }`}
              >
                {l.label}
              </a>
            ))}
          </div>

          {!credsDismissed && coderTempPassword && (
            <div className="rounded border border-white/15 bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-200">Coder credentials</h2>
                <button
                  type="button"
                  onClick={dismissCreds}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
              <p className="mb-3 text-xs text-gray-400">
                If Coder asks you to log in when opening the workspace, use these credentials. They
                are shown once — write them down or copy now.
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-400">Email</dt>
                  <dd className="font-mono text-gray-100">{coderEmail}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-gray-400">Temp password</dt>
                  <dd className="flex items-center gap-2">
                    <code className="rounded bg-black/40 px-2 py-0.5 font-mono text-gray-100">
                      {coderTempPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(coderTempPassword)}
                      className="rounded border border-white/15 px-2 py-0.5 text-xs text-gray-300 hover:bg-white/10"
                    >
                      Copy
                    </button>
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}

      {sandbox.status === 'failed' && (
        <div className="space-y-3">
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {sandbox.status_message || 'Workspace provisioning failed.'}
          </div>
          <button
            type="button"
            onClick={onDeleteAndRetry}
            disabled={deleting}
            className="rounded bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete and retry'}
          </button>
        </div>
      )}

      {sandbox.status !== 'ready' && sandbox.status !== 'failed' && (
        <p className="text-sm text-gray-400">
          Provisioning typically takes 2-4 minutes. This page polls every 3 seconds and will update
          automatically.
        </p>
      )}
    </div>
  );
}
