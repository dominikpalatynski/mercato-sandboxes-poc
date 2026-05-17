'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleDashed,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface LogLine {
  id: number;
  created_at: string;
  log_level: string;
  output: string;
  stage?: string;
}

interface LogsResponse {
  buildLogs: LogLine[];
  agentLogs: LogLine[];
  buildId: string | null;
  agentId: string | null;
  jobStatus: string | null;
  lifecycleState: string | null;
}

export interface ProvisioningConsoleProps {
  sandboxId: string;
  /** Current sandbox status from the parent (so we know when to stop polling). */
  status: string;
  /** Status message shown above the stepper. */
  statusMessage: string | null;
  /** Optional override poll interval (ms). */
  intervalMs?: number;
}

type StepKey = 'created' | 'queued' | 'provisioning' | 'agent' | 'app';
type StepState = 'pending' | 'active' | 'done' | 'failed';

interface Step {
  key: StepKey;
  label: string;
  detail: string;
}

const STEPS: Step[] = [
  { key: 'created', label: 'Sandbox created', detail: 'Database row + Coder workspace request' },
  { key: 'queued', label: 'Build queued', detail: 'Coder picked up the build job' },
  { key: 'provisioning', label: 'Provisioning infrastructure', detail: 'Terraform + docker (postgres + workspace)' },
  { key: 'agent', label: 'Agent connected', detail: 'Workspace container booted, Coder agent online' },
  { key: 'app', label: 'Mercato app starting', detail: 'startup_script ran, dev server warming up' },
];

function deriveStepStates(args: {
  jobStatus: string | null;
  lifecycleState: string | null;
  status: string;
}): Record<StepKey, StepState> {
  const s: Record<StepKey, StepState> = {
    created: 'done',
    queued: 'pending',
    provisioning: 'pending',
    agent: 'pending',
    app: 'pending',
  };

  if (args.status === 'failed') {
    // Walk forward until we hit the first non-done step and mark it failed.
    const order: StepKey[] = ['created', 'queued', 'provisioning', 'agent', 'app'];
    let failedSet = false;
    for (const k of order) {
      if (k === 'created') continue;
      if (!failedSet) {
        s[k] = 'failed';
        failedSet = true;
      } else {
        s[k] = 'pending';
      }
    }
    // Heuristic: if the build job actually succeeded but app is the failure → mark earlier steps done.
    if (args.jobStatus === 'succeeded') {
      s.queued = 'done';
      s.provisioning = 'done';
      s.agent = 'done';
      s.app = 'failed';
    } else if (args.jobStatus === 'running') {
      s.queued = 'done';
      s.provisioning = 'failed';
    }
    return s;
  }

  // Job pending → queued is active.
  if (args.jobStatus === 'pending' || args.jobStatus === null) {
    s.queued = 'active';
    return s;
  }

  // Job running → queued done, provisioning active.
  if (args.jobStatus === 'running') {
    s.queued = 'done';
    s.provisioning = 'active';
    return s;
  }

  // Job succeeded → provisioning done; agent/app depend on lifecycle.
  if (args.jobStatus === 'succeeded') {
    s.queued = 'done';
    s.provisioning = 'done';
    if (args.lifecycleState === 'ready' || args.status === 'ready') {
      s.agent = 'done';
      s.app = 'done';
    } else if (args.lifecycleState === 'starting') {
      s.agent = 'done';
      s.app = 'active';
    } else {
      s.agent = 'active';
    }
    return s;
  }

  return s;
}

function StepIcon({ state }: { state: StepState }): React.ReactElement {
  let Icon: LucideIcon = CircleDashed;
  let cls = 'text-muted-foreground';
  if (state === 'active') {
    Icon = Loader2;
    cls = 'text-primary animate-spin';
  } else if (state === 'done') {
    Icon = Check;
    cls = 'text-emerald-500';
  } else if (state === 'failed') {
    Icon = XCircle;
    cls = 'text-destructive';
  }
  return <Icon className={cn('h-4 w-4', cls)} />;
}

function Stepper({ states }: { states: Record<StepKey, StepState> }): React.ReactElement {
  return (
    <ol className="space-y-3" aria-label="Provisioning steps">
      {STEPS.map((step, idx) => {
        const state = states[step.key];
        return (
          <li
            key={step.key}
            className={cn(
              'flex items-start gap-3 rounded-md border border-border/60 bg-muted/20 p-3 transition-colors',
              state === 'active' && 'border-primary/40 bg-primary/5',
              state === 'failed' && 'border-destructive/50 bg-destructive/5',
              state === 'done' && 'opacity-80',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                state === 'done' && 'border-emerald-500/40 bg-emerald-500/10',
                state === 'active' && 'border-primary/40 bg-primary/10',
                state === 'failed' && 'border-destructive/40 bg-destructive/10',
                state === 'pending' && 'border-border bg-background',
              )}
            >
              <StepIcon state={state} />
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {idx + 1}. {step.label}
                </span>
                {state === 'active' && (
                  <span className="text-[10px] uppercase tracking-wider text-primary">
                    in progress
                  </span>
                )}
                {state === 'failed' && (
                  <span className="text-[10px] uppercase tracking-wider text-destructive">
                    failed
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface LogPaneProps {
  lines: LogLine[];
  emptyHint: string;
  autoScroll: boolean;
  onAutoScrollChange: (v: boolean) => void;
}

function LogPane({ lines, emptyHint, autoScroll, onAutoScrollChange }: LogPaneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextScrollEvent = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (autoScroll) {
      skipNextScrollEvent.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, autoScroll]);

  function onScroll(): void {
    if (skipNextScrollEvent.current) {
      skipNextScrollEvent.current = false;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 80 && autoScroll) onAutoScrollChange(false);
    else if (distanceFromBottom <= 8 && !autoScroll) onAutoScrollChange(true);
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-black text-emerald-200 shadow-inner">
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="h-72 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-emerald-300/40">{emptyHint}</p>
        ) : (
          lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                'whitespace-pre-wrap break-all',
                l.log_level === 'error' && 'text-red-300',
                l.log_level === 'warn' && 'text-amber-300',
              )}
            >
              {l.output}
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t border-emerald-900/40 bg-black px-3 py-1.5 text-[10px] text-emerald-300/70">
        <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => onAutoScrollChange(e.target.checked)}
            className="h-3 w-3 accent-emerald-400"
          />
          auto-scroll
        </label>
      </div>
    </div>
  );
}

export default function ProvisioningConsole({
  sandboxId,
  status,
  statusMessage,
  intervalMs = 2_500,
}: ProvisioningConsoleProps): React.ReactElement {
  const [buildLogs, setBuildLogs] = useState<LogLine[]>([]);
  const [agentLogs, setAgentLogs] = useState<LogLine[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [lifecycleState, setLifecycleState] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'agent'>('build');
  const [autoScroll, setAutoScroll] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const buildAfterRef = useRef(0);
  const agentAfterRef = useRef(0);
  const stoppedRef = useRef(false);
  const autoSwitchedRef = useRef(false);

  const polling = status !== 'ready' && status !== 'failed' && status !== 'stopped';

  useEffect(() => {
    stoppedRef.current = false;
    if (status === 'ready' || status === 'stopped') return; // No need to stream once the workspace is terminal.

    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick(): Promise<void> {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(
          `/api/sandboxes/${sandboxId}/logs?buildAfter=${buildAfterRef.current}&agentAfter=${agentAfterRef.current}`,
          { cache: 'no-store' },
        );
        if (res.ok) {
          const data = (await res.json()) as LogsResponse;
          setJobStatus(data.jobStatus);
          setLifecycleState(data.lifecycleState);
          if (data.buildLogs.length > 0) {
            setBuildLogs((prev) => [...prev, ...data.buildLogs]);
            buildAfterRef.current = data.buildLogs[data.buildLogs.length - 1]!.id;
          }
          if (data.agentLogs.length > 0) {
            setAgentLogs((prev) => [...prev, ...data.agentLogs]);
            agentAfterRef.current = data.agentLogs[data.agentLogs.length - 1]!.id;
          }
        }
      } catch {
        /* ignore */
      }
      if (!stoppedRef.current && status !== 'ready' && status !== 'stopped')
        timer = setTimeout(tick, intervalMs);
    }
    void tick();
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sandboxId, status, intervalMs]);

  const stepStates = useMemo(
    () => deriveStepStates({ jobStatus, lifecycleState, status }),
    [jobStatus, lifecycleState, status],
  );

  useEffect(() => {
    if (autoSwitchedRef.current) return;
    if (status === 'failed') return;
    if (jobStatus === 'succeeded') {
      autoSwitchedRef.current = true;
      setTab('agent');
    }
  }, [jobStatus, status]);

  async function onCancel(): Promise<void> {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/sandboxes/${sandboxId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCancelError((body as { error?: string }).error || `Cancel failed (${res.status})`);
      }
    } catch (e) {
      setCancelError(String(e).slice(0, 200));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Provisioning your sandbox</h2>
            {statusMessage && (
              <p className="mt-0.5 text-xs text-muted-foreground">{statusMessage}</p>
            )}
          </div>
          {polling && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={cancelling}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {cancelling ? 'Cancelling…' : 'Cancel build'}
            </Button>
          )}
        </div>
        <Stepper states={stepStates} />
        {cancelError && (
          <p className="mt-3 text-xs text-destructive">{cancelError}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'build' | 'agent')}>
          <div className="mb-3 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="build">Build logs</TabsTrigger>
              <TabsTrigger value="agent">Agent logs</TabsTrigger>
            </TabsList>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              live
            </span>
          </div>
          <TabsContent value="build">
            <LogPane
              lines={buildLogs}
              emptyHint="Waiting for terraform/docker output…"
              autoScroll={autoScroll}
              onAutoScrollChange={setAutoScroll}
            />
          </TabsContent>
          <TabsContent value="agent">
            <LogPane
              lines={agentLogs}
              emptyHint="Agent has not produced any output yet — the workspace container is still booting."
              autoScroll={autoScroll}
              onAutoScrollChange={setAutoScroll}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
