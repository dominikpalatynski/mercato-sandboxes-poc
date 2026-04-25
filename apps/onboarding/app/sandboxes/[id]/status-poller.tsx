'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBadge from '@/components/status-badge';

export interface SandboxView {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
  // Set on the server when rendering the page; safe to expose (already in DB).
  coder_owner_name?: string | null;
  coder_workspace_name?: string | null;
}

interface Props {
  initial: SandboxView;
  coderEmail: string;
  coderTempPassword: string | null;
}

const POLL_INTERVAL_MS = 3_000;

// next.config.js inlines this at build time; default keeps local dev sane.
const CODER_PUBLIC_URL =
  (process.env.NEXT_PUBLIC_CODER_URL || 'http://localhost:7080').replace(/\/$/, '');

interface LinkSpec {
  label: string;
  subtitle: string;
  url: string | null;
}

export default function StatusPoller({ initial, coderEmail, coderTempPassword }: Props) {
  const router = useRouter();
  const [sandbox, setSandbox] = useState<SandboxView>(initial);
  const [credsDismissed, setCredsDismissed] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [deleting, setDeleting] = useState(false);
  const stoppedRef = useRef(false);

  // sessionStorage (NOT localStorage): the panel reappears on a fresh page
  // load so users can re-grab the temp password if they need it again.
  useEffect(() => {
    try {
      const flag = window.sessionStorage.getItem(`sandbox-creds-dismissed:${initial.id}`);
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
          // The status API doesn't echo coder_owner_name / coder_workspace_name —
          // preserve those from the initial server-rendered props.
          setSandbox((prev) => ({
            ...data,
            coder_owner_name: prev.coder_owner_name ?? data.coder_owner_name ?? null,
            coder_workspace_name: prev.coder_workspace_name ?? data.coder_workspace_name ?? null,
          }));
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
      window.sessionStorage.setItem(`sandbox-creds-dismissed:${initial.id}`, '1');
    } catch {
      /* ignore */
    }
    setCredsDismissed(true);
  }, [initial.id]);

  const onCopy = useCallback(async () => {
    if (!coderTempPassword) return;
    try {
      await navigator.clipboard?.writeText(coderTempPassword);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1_500);
    } catch {
      /* ignore */
    }
  }, [coderTempPassword]);

  const onDeleteAndRetry = useCallback(async () => {
    setDeleting(true);
    try {
      await fetch(`/api/sandboxes/${initial.id}`, { method: 'DELETE' });
    } finally {
      router.push('/sandboxes/new');
    }
  }, [initial.id, router]);

  const dashboardUrl = useMemo(() => {
    if (!sandbox.coder_owner_name || !sandbox.coder_workspace_name) return null;
    return `${CODER_PUBLIC_URL}/@${sandbox.coder_owner_name}/${sandbox.coder_workspace_name}`;
  }, [sandbox.coder_owner_name, sandbox.coder_workspace_name]);

  const links: LinkSpec[] = [
    { label: 'Open in VS Code', subtitle: 'Browser-based VS Code', url: sandbox.vscode_url },
    { label: 'Open Terminal', subtitle: 'Web terminal session', url: sandbox.terminal_url },
    { label: 'Open Mercato App', subtitle: 'Direct port (3000)', url: sandbox.app_url },
    { label: 'Open Splash', subtitle: 'Build progress (4000)', url: sandbox.splash_url },
    { label: 'Open Coder dashboard', subtitle: 'Workspace overview', url: dashboardUrl },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <StatusBadge status={sandbox.status} />
        {sandbox.status === 'building' && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
        )}
        {sandbox.status_message && (
          <span className="text-sm text-gray-400">{sandbox.status_message}</span>
        )}
      </div>

      {sandbox.status === 'ready' && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.url ?? '#'}
                target="_blank"
                rel="noopener"
                aria-disabled={!l.url}
                className={`flex min-h-14 flex-col items-start justify-center rounded-lg border p-4 text-left transition ${
                  l.url
                    ? 'border-slate-700/50 bg-slate-900/40 hover:bg-slate-800/50'
                    : 'cursor-not-allowed border-slate-800 bg-slate-900/20 opacity-60'
                }`}
              >
                <span
                  className={`text-base font-medium ${l.url ? 'text-gray-100' : 'text-gray-500'}`}
                >
                  {l.label}
                </span>
                <span className="mt-0.5 text-xs text-gray-400">{l.subtitle}</span>
              </a>
            ))}
          </div>

          <p className="text-xs text-gray-400">
            VS Code is ready immediately. The Mercato app on port 3000 takes 3-7 minutes to finish
            building on first start - watch the splash for progress.
          </p>

          {!credsDismissed && coderTempPassword && (
            <div className="rounded-lg border border-yellow-700/30 bg-yellow-950/20 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-yellow-100">Coder credentials</h2>
                <button
                  type="button"
                  onClick={dismissCreds}
                  className="text-xs text-yellow-200/80 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
              <p className="mb-3 text-xs text-yellow-100/70">
                If Coder asks you to log in when opening the workspace, use these credentials. They
                are shown once — write them down or copy now.
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-yellow-100/70">Email</dt>
                  <dd className="font-mono text-yellow-50">{coderEmail}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-yellow-100/70">Temp password</dt>
                  <dd className="flex items-center gap-2">
                    <code className="rounded bg-black/40 px-2 py-0.5 font-mono text-yellow-50">
                      {showPassword ? coderTempPassword : '•'.repeat(coderTempPassword.length)}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="rounded border border-yellow-700/40 px-2 py-0.5 text-xs text-yellow-100 hover:bg-yellow-900/40"
                    >
                      {showPassword ? 'hide' : 'show'}
                    </button>
                    <button
                      type="button"
                      onClick={onCopy}
                      className="rounded border border-yellow-700/40 px-2 py-0.5 text-xs text-yellow-100 hover:bg-yellow-900/40"
                    >
                      {copyState === 'copied' ? 'Copied!' : 'Copy'}
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
