'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AppWindow,
  Code2,
  Info,
  LayoutDashboard,
  Loader,
  Loader2,
  Pause,
  Play,
  Settings,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProvisioningConsole from '@/components/provisioning-console';
import WorkspaceStats from '@/components/workspace-stats';
import { getSandboxPreset, type SandboxPresetId } from '@/lib/sandbox-presets';
import { cn } from '@/lib/utils';
import SettingsPanel from './settings-panel';

export interface SandboxView {
  id: string;
  name: string;
  preset_id: SandboxPresetId;
  status: string;
  status_message: string | null;
  vscode_url: string | null;
  terminal_url: string | null;
  app_url: string | null;
  splash_url: string | null;
  // Set on the server when rendering the page; safe to expose (already in DB).
  coder_owner_name?: string | null;
  coder_workspace_name?: string | null;
  // Repo state — kept fresh by the status poller so the Settings tab re-renders
  // the moment the Gitea repo gets provisioned server-side.
  repo_origin?: string;
  gitea_clone_url?: string | null;
  gitea_org_name?: string | null;
  created_at?: string | null;
}

interface Props {
  initial: SandboxView;
  coderEmail: string;
  coderTempPassword: string | null;
  coderPublicUrl: string;
  giteaPassword: string | null;
}

const POLL_INTERVAL_MS = 3_000;

function isTerminalStatus(status: string): boolean {
  return status === 'ready' || status === 'failed' || status === 'stopped';
}

interface LinkSpec {
  label: string;
  subtitle: string;
  url: string | null;
  icon: LucideIcon;
}

function coderLoginHref(sandboxId: string, target: string): string {
  return `/api/coder-login?sandbox_id=${encodeURIComponent(sandboxId)}&next=${encodeURIComponent(target)}`;
}

export default function StatusPoller({
  initial,
  coderEmail,
  coderTempPassword,
  coderPublicUrl,
  giteaPassword,
}: Props) {
  const router = useRouter();
  const [sandbox, setSandbox] = useState<SandboxView>(initial);
  const [deleting, setDeleting] = useState(false);
  const [actioning, setActioning] = useState<'pause' | 'resume' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'workspace' | 'settings'>('workspace');
  const stoppedRef = useRef(false);

  // Persist the selected tab per-sandbox so polling-driven re-renders or page
  // reloads don't snap the user back to "Workspace" while they were reading
  // the Settings panel.
  useEffect(() => {
    try {
      const flag = window.sessionStorage.getItem(`sandbox-tab:${initial.id}`);
      if (flag === 'settings' || flag === 'workspace') setActiveTab(flag);
    } catch {
      /* ignore */
    }
  }, [initial.id]);

  const onTabChange = useCallback(
    (next: string) => {
      if (next !== 'workspace' && next !== 'settings') return;
      setActiveTab(next);
      try {
        window.sessionStorage.setItem(`sandbox-tab:${initial.id}`, next);
      } catch {
        /* ignore */
      }
    },
    [initial.id],
  );

  const refreshStatus = useCallback(async (): Promise<SandboxView | null> => {
    try {
      const res = await fetch(`/api/sandboxes/${initial.id}/status`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as SandboxView;
      // The status API doesn't echo coder_owner_name / coder_workspace_name —
      // preserve those from the initial server-rendered props.
      setSandbox((prev) => ({
        ...data,
        preset_id: data.preset_id ?? prev.preset_id,
        coder_owner_name: prev.coder_owner_name ?? data.coder_owner_name ?? null,
        coder_workspace_name: prev.coder_workspace_name ?? data.coder_workspace_name ?? null,
        repo_origin: data.repo_origin ?? prev.repo_origin,
        gitea_clone_url: data.gitea_clone_url ?? prev.gitea_clone_url ?? null,
        gitea_org_name: prev.gitea_org_name ?? data.gitea_org_name ?? null,
        created_at: prev.created_at ?? data.created_at ?? null,
      }));
      return data;
    } catch {
      return null;
    }
  }, [initial.id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    stoppedRef.current = false;

    async function tick() {
      if (stoppedRef.current) return;
      const data = await refreshStatus();
      if (data && isTerminalStatus(data.status)) {
        stoppedRef.current = true;
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    if (sandbox.status === 'failed' || sandbox.status === 'stopped') {
      stoppedRef.current = true;
    } else {
      timer = setTimeout(tick, sandbox.status === 'ready' ? 0 : POLL_INTERVAL_MS);
    }
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [initial.id, refreshStatus, sandbox.status]);

  useEffect(() => {
    if (isTerminalStatus(sandbox.status)) {
      setActioning(null);
    }
  }, [sandbox.status]);

  const onDeleteAndRetry = useCallback(async () => {
    setDeleting(true);
    try {
      await fetch(`/api/sandboxes/${initial.id}`, { method: 'DELETE' });
    } finally {
      router.push('/sandboxes/new');
    }
  }, [initial.id, router]);

  const runWorkspaceAction = useCallback(
    async (action: 'pause' | 'resume') => {
      setActioning(action);
      setActionError(null);
      try {
        const res = await fetch(`/api/sandboxes/${initial.id}/${action}`, { method: 'POST' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setActionError(body.error || `${action} failed (${res.status})`);
          setActioning(null);
          return;
        }
        setSandbox((prev) => ({
          ...prev,
          status: 'building',
          status_message: action === 'pause' ? 'Stopping workspace…' : 'Starting workspace…',
        }));
      } catch (e) {
        setActionError(String(e).slice(0, 200));
        setActioning(null);
      }
    },
    [initial.id],
  );

  const dashboardUrl = useMemo(() => {
    if (!sandbox.coder_owner_name || !sandbox.coder_workspace_name) return null;
    return `${coderPublicUrl}/@${sandbox.coder_owner_name}/${sandbox.coder_workspace_name}`;
  }, [coderPublicUrl, sandbox.coder_owner_name, sandbox.coder_workspace_name]);

  // Smaller link grid — Coder dashboard CTA is promoted to its own primary
  // card above the grid, so it's not duplicated here. The browser still
  // carries the `coder_session_token` cookie via /api/coder-login for all
  // of these workspace URLs.
  const workspaceLinks: LinkSpec[] = [
    { label: 'Open in VS Code', subtitle: 'Browser-based VS Code', url: sandbox.vscode_url, icon: Code2 },
    { label: 'Open Terminal', subtitle: 'Web terminal session', url: sandbox.terminal_url, icon: Terminal },
    { label: 'Open Mercato App', subtitle: 'Port 3000 via Coder wildcard', url: sandbox.app_url, icon: AppWindow },
    { label: 'Open Splash', subtitle: 'Port 4000 via Coder wildcard', url: sandbox.splash_url, icon: Loader },
  ];

  const isWorkspaceActionPending = actioning !== null && sandbox.status === 'building';
  const presetLabel = getSandboxPreset(sandbox.preset_id)?.displayName ?? sandbox.preset_id;
  const coderDashboardHref = dashboardUrl ? coderLoginHref(initial.id, dashboardUrl) : null;

  return (
    <div className="space-y-8">
      {/* Header strip */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="font-mono text-3xl font-semibold tracking-tight">{sandbox.name}</h1>
        <div className="flex items-center gap-2">
          <StatusBadge status={sandbox.status} />
          {sandbox.status === 'ready' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runWorkspaceAction('pause')}
              disabled={actioning !== null}
            >
              {actioning === 'pause' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              Pause
            </Button>
          )}
          {sandbox.status === 'stopped' && (
            <Button
              type="button"
              size="sm"
              onClick={() => void runWorkspaceAction('resume')}
              disabled={actioning !== null}
            >
              {actioning === 'resume' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Resume
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Ready state — split into Workspace / Settings tabs */}
      {sandbox.status === 'ready' && (
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="workspace">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Workspace
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="mt-6 space-y-6">
            <WorkspaceStats sandboxId={initial.id} enabled variant="wide" />

            {coderDashboardHref ? (
              <a
                href={coderDashboardHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-primary/40 bg-primary/5 p-6 transition hover:border-primary/60 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <LayoutDashboard className="h-7 w-7" />
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-lg font-semibold text-foreground">
                      Open in Coder dashboard
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">
                      Auto sign-in to your Coder workspace overview — start here.
                    </span>
                  </div>
                </div>
              </a>
            ) : (
              <div className="rounded-xl border border-border/60 bg-card p-6 opacity-60">
                <div className="flex items-center gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <LayoutDashboard className="h-7 w-7" />
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-lg font-semibold text-foreground">
                      Open in Coder dashboard
                    </span>
                    <span className="mt-1 text-sm text-muted-foreground">
                      Dashboard URL not available yet.
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {workspaceLinks.map((l) => {
                const Icon = l.icon;
                const disabled = !l.url;
                const cardClass = cn(
                  'block min-h-28 rounded-lg border bg-card p-5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  disabled
                    ? 'cursor-not-allowed border-border/60 opacity-60'
                    : 'border-border hover:border-primary/40 hover:shadow-glow',
                );
                const content = (
                  <div className="flex h-full items-start gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-base font-semibold text-foreground">{l.label}</span>
                      <span className="mt-1 text-sm text-muted-foreground">{l.subtitle}</span>
                    </div>
                  </div>
                );
                const href = !disabled && l.url ? coderLoginHref(initial.id, l.url) : '#';
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

            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
              <p>
                VS Code is ready immediately. The Mercato app on port 3000 takes 3-7 minutes
                to finish building on first start — watch the splash for progress.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <SettingsPanel
              sandboxId={initial.id}
              sandboxName={sandbox.name}
              presetId={sandbox.preset_id}
              presetLabel={presetLabel}
              repoOrigin={sandbox.repo_origin ?? null}
              createdAt={sandbox.created_at ?? null}
              giteaCloneUrl={sandbox.gitea_clone_url ?? null}
              giteaOrgName={sandbox.gitea_org_name ?? null}
              giteaPassword={giteaPassword}
              coderEmail={coderEmail}
              coderTempPassword={coderTempPassword}
            />
          </TabsContent>
        </Tabs>
      )}

      {sandbox.status === 'stopped' && (
        <Card className="border-border/80 bg-card/90">
          <div className="flex flex-row items-center gap-2 p-6 pb-3">
            <Pause className="h-5 w-5 text-foreground/80" />
            <h2 className="text-base font-semibold leading-none">Workspace paused</h2>
          </div>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground">
              {sandbox.status_message || 'The workspace compute is stopped, but its files and database are kept.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Resume starts the same Coder workspace again and reuses its existing storage.
            </p>
            <div>
              <Button
                type="button"
                onClick={() => void runWorkspaceAction('resume')}
                disabled={actioning !== null}
              >
                {actioning === 'resume' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Resume workspace
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isWorkspaceActionPending && (
        <Card className="border-border/80 bg-card/90">
          <div className="flex flex-row items-center gap-2 p-6 pb-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <h2 className="text-base font-semibold leading-none">
              {actioning === 'pause' ? 'Pausing workspace' : 'Starting workspace'}
            </h2>
          </div>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground">
              {sandbox.status_message || (actioning === 'pause' ? 'Stopping workspace…' : 'Starting workspace…')}
            </p>
            <p className="text-xs text-muted-foreground">
              This can take a few seconds while Coder applies the workspace transition.
            </p>
          </CardContent>
        </Card>
      )}

      {sandbox.status === 'failed' && (
        <>
          <Card className="border-destructive/40 bg-destructive/5">
            <div className="flex flex-row items-center gap-2 p-6 pb-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <h2 className="text-base font-semibold leading-none">Provisioning failed</h2>
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

      {sandbox.status !== 'ready' &&
        sandbox.status !== 'failed' &&
        sandbox.status !== 'stopped' &&
        !isWorkspaceActionPending && (
          <ProvisioningConsole
            sandboxId={initial.id}
            status={sandbox.status}
            statusMessage={sandbox.status_message}
          />
        )}
    </div>
  );
}
