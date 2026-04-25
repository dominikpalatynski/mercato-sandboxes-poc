'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AppWindow,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader,
  LayoutDashboard,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import ProvisioningConsole from '@/components/provisioning-console';
import WorkspaceStats from '@/components/workspace-stats';
import { cn } from '@/lib/utils';

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
  icon: LucideIcon;
  /**
   * When true, the link is wrapped through `/api/coder-login?next=…` so the
   * browser is auto-logged-in to Coder via a `coder_session_token` cookie
   * scoped to the parent .sandbox.lvh.me domain.
   */
  viaCoderLogin?: boolean;
}

function coderLoginHref(sandboxId: string, target: string): string {
  return `/api/coder-login?sandbox_id=${encodeURIComponent(sandboxId)}&next=${encodeURIComponent(target)}`;
}

export default function StatusPoller({ initial, coderEmail, coderTempPassword }: Props) {
  const router = useRouter();
  const [sandbox, setSandbox] = useState<SandboxView>(initial);
  const [copyState, setCopyState] = useState<'idle' | 'id' | 'email' | 'password'>('idle');
  const [deleting, setDeleting] = useState(false);
  const [credsDismissed, setCredsDismissed] = useState<boolean>(false);
  const [credsOpen, setCredsOpen] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const stoppedRef = useRef(false);

  // sessionStorage (NOT localStorage): the panel reappears on a fresh page
  // load so users can re-grab the temp password if they need it again.
  // We also persist the open/closed preference so polling-driven re-renders
  // don't snap the panel back to its default folded state.
  useEffect(() => {
    try {
      const flag = window.sessionStorage.getItem(`sandbox-creds-dismissed:${initial.id}`);
      if (flag === '1') setCredsDismissed(true);
      const openFlag = window.sessionStorage.getItem(`sandbox-creds-open:${initial.id}`);
      if (openFlag === '1') setCredsOpen(true);
    } catch {
      /* ignore */
    }
  }, [initial.id]);

  const onCredsOpenChange = useCallback(
    (open: boolean) => {
      setCredsOpen(open);
      try {
        window.sessionStorage.setItem(
          `sandbox-creds-open:${initial.id}`,
          open ? '1' : '0',
        );
      } catch {
        /* ignore */
      }
    },
    [initial.id],
  );

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

  const copyToClipboard = useCallback(
    async (value: string, kind: 'id' | 'email' | 'password') => {
      try {
        await navigator.clipboard?.writeText(value);
        setCopyState(kind);
        setTimeout(() => setCopyState('idle'), 1_500);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const dismissCreds = useCallback(() => {
    try {
      window.sessionStorage.setItem(`sandbox-creds-dismissed:${initial.id}`, '1');
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

  const dashboardUrl = useMemo(() => {
    if (!sandbox.coder_owner_name || !sandbox.coder_workspace_name) return null;
    return `${CODER_PUBLIC_URL}/@${sandbox.coder_owner_name}/${sandbox.coder_workspace_name}`;
  }, [sandbox.coder_owner_name, sandbox.coder_workspace_name]);

  const links: LinkSpec[] = [
    { label: 'Open in VS Code', subtitle: 'Browser-based VS Code', url: sandbox.vscode_url, icon: Code2, viaCoderLogin: true },
    { label: 'Open Terminal', subtitle: 'Web terminal session', url: sandbox.terminal_url, icon: Terminal, viaCoderLogin: true },
    { label: 'Open Mercato App', subtitle: 'Direct port (3000)', url: sandbox.app_url, icon: AppWindow },
    { label: 'Open Splash', subtitle: 'Build progress (4000)', url: sandbox.splash_url, icon: Loader },
    { label: 'Open Coder dashboard', subtitle: 'Workspace overview', url: dashboardUrl, icon: LayoutDashboard, viaCoderLogin: true },
  ];

  const truncatedId = `${initial.id.slice(0, 8)}…${initial.id.slice(-4)}`;

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-mono text-3xl font-semibold tracking-tight">
            {sandbox.name}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">id: {truncatedId}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(initial.id, 'id')}
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] hover:bg-accent hover:text-accent-foreground"
              aria-label="Copy full sandbox id"
            >
              <Copy className="h-3 w-3" />
              {copyState === 'id' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={sandbox.status} />
        </div>
      </div>

      {/* Ready state */}
      {sandbox.status === 'ready' && (
        <>
          {/* Coder credentials — folded by default, fallback for when the
              automatic Coder cookie hand-off is unavailable. */}
          {!credsDismissed && coderTempPassword && (
            <Collapsible
              open={credsOpen}
              onOpenChange={onCredsOpenChange}
              asChild
            >
              <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
                <div className="flex flex-row items-center justify-between gap-2 p-3">
                  <CollapsibleTrigger
                    className="group flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={credsOpen ? 'Hide Coder credentials' : 'Show Coder credentials'}
                  >
                    <ChevronRight className="h-4 w-4 text-primary transition-transform group-data-[state=open]:rotate-90" />
                    <KeyRound className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold leading-none">
                      Coder credentials
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      (fallback if auto sign-in fails)
                    </span>
                  </CollapsibleTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={dismissCreds}
                  >
                    Dismiss
                  </Button>
                </div>
                <CollapsibleContent>
                  <CardContent className="space-y-3 pt-0">
                    <dl className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Email</dt>
                        <dd className="flex items-center gap-2">
                          <code className="rounded bg-background/60 px-2 py-0.5 font-mono text-foreground">
                            {coderEmail}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(coderEmail, 'email')}
                            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] hover:bg-accent hover:text-accent-foreground"
                            aria-label="Copy email"
                          >
                            <Copy className="h-3 w-3" />
                            {copyState === 'email' ? 'Copied!' : 'Copy'}
                          </button>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Temp password</dt>
                        <dd className="flex items-center gap-2">
                          <code className="rounded bg-background/60 px-2 py-0.5 font-mono text-foreground">
                            {showPassword ? coderTempPassword : '•'.repeat(Math.min(coderTempPassword.length, 12))}
                          </code>
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="inline-flex h-7 items-center justify-center rounded-sm border border-border px-2 hover:bg-accent hover:text-accent-foreground"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(coderTempPassword, 'password')}
                            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] hover:bg-accent hover:text-accent-foreground"
                            aria-label="Copy password"
                          >
                            <Copy className="h-3 w-3" />
                            {copyState === 'password' ? 'Copied!' : 'Copy'}
                          </button>
                        </dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Use these if Coder asks you to log in. The password is shown only this once.
                    </p>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <WorkspaceStats sandboxId={initial.id} enabled variant="wide" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {links.map((l) => {
              const Icon = l.icon;
              const disabled = !l.url;
              const cardClass = cn(
                'block min-h-32 rounded-lg border bg-card p-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                disabled
                  ? 'cursor-not-allowed border-border/60 opacity-60'
                  : 'border-border hover:border-primary/40 hover:shadow-glow',
              );
              const content = (
                <div className="flex h-full items-start gap-4">
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-base font-semibold text-foreground">
                      {l.label}
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">
                      {l.subtitle}
                    </span>
                  </div>
                </div>
              );
              const href = l.url ?? '#';
              return disabled ? (
                <div key={l.label} className={cardClass}>
                  {content}
                </div>
              ) : (
                <a
                  key={l.label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cardClass}
                >
                  {content}
                </a>
              );
            })}
          </div>

          {/* Info note */}
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
            <p>
              VS Code is ready immediately. The Mercato app on port 3000
              takes 3-7 minutes to finish building on first start — watch
              the splash for progress.
            </p>
          </div>

        </>
      )}

      {/* Failed state — keep the streaming console visible (logs explain WHY it failed) */}
      {sandbox.status === 'failed' && (
        <>
          <Card className="border-destructive/40 bg-destructive/5">
            <div className="flex flex-row items-center gap-2 p-6 pb-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <h2 className="text-base font-semibold leading-none">
                Provisioning failed
              </h2>
            </div>
            <CardContent className="space-y-4">
              <p className="text-sm text-foreground">
                {sandbox.status_message || 'Workspace provisioning failed.'}
              </p>
              <p className="text-xs text-muted-foreground">
                Scroll the build / agent logs below to see what went wrong.
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={onDeleteAndRetry}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete and retry'}
              </Button>
            </CardContent>
          </Card>
          <ProvisioningConsole
            sandboxId={initial.id}
            status={sandbox.status}
            statusMessage={sandbox.status_message}
          />
        </>
      )}

      {/* Building / pending state — full provisioning console */}
      {sandbox.status !== 'ready' && sandbox.status !== 'failed' && (
        <ProvisioningConsole
          sandboxId={initial.id}
          status={sandbox.status}
          statusMessage={sandbox.status_message}
        />
      )}
    </div>
  );
}
