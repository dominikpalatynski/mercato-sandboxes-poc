'use client';

// A compact 4-step icon row that visualizes a sandbox's build progress.
// Used in the dashboard card subtitle (and reusable on the sandbox detail
// page header) as a friendlier replacement for the raw
// `job=…, lifecycle=…` debug string we used to render.
//
// The dashboard list endpoint only persists a `status_message` string, so we
// also expose `parseStatusMessage()` to recover the structured fields from
// strings like `job=succeeded, lifecycle=starting`.

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Cog,
  Hammer,
  Loader2,
  Power,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type MicroStepState = 'pending' | 'active' | 'done' | 'failed';

interface MicroStep {
  key: string;
  label: string;
  Icon: LucideIcon;
  state: MicroStepState;
}

export interface BuildMicrostepsInput {
  /** Top-level sandbox status (`pending` | `building` | `ready` | `failed` | …). */
  status: string;
  /** Coder job status (`pending` | `running` | `succeeded` | `failed` | `canceled`). */
  jobStatus: string | null;
  /** Coder agent connection status. */
  agentStatus: string | null;
  /** Coder agent lifecycle state (`created` | `starting` | `ready` | `start_timeout` | `start_error`). */
  lifecycleState: string | null;
}

/**
 * Recover {jobStatus, lifecycleState} from a persisted message string of the
 * form `job=succeeded, lifecycle=starting`. Returns nulls when the field
 * isn't present (e.g. the message is a free-form error).
 */
export function parseStatusMessage(
  msg: string | null | undefined,
): { jobStatus: string | null; lifecycleState: string | null } {
  if (!msg) return { jobStatus: null, lifecycleState: null };
  const job = /\bjob=([a-z_]+)/i.exec(msg)?.[1] ?? null;
  const lifecycle = /\blifecycle=([a-z_]+)/i.exec(msg)?.[1] ?? null;
  return { jobStatus: job, lifecycleState: lifecycle };
}

function deriveBuildState(jobStatus: string | null): MicroStepState {
  if (jobStatus === 'failed' || jobStatus === 'canceled') return 'failed';
  if (jobStatus === 'succeeded') return 'done';
  if (jobStatus === 'running' || jobStatus === 'pending') return 'active';
  return 'pending';
}

function deriveBootState(
  jobStatus: string | null,
  agentStatus: string | null,
): MicroStepState {
  if (agentStatus === 'connected') return 'done';
  if (agentStatus === 'timeout' || agentStatus === 'disconnected') return 'failed';
  if (jobStatus === 'succeeded') return 'active';
  return 'pending';
}

function deriveSetupState(
  jobStatus: string | null,
  lifecycleState: string | null,
): MicroStepState {
  if (lifecycleState === 'ready') return 'done';
  if (lifecycleState === 'start_timeout' || lifecycleState === 'start_error') return 'failed';
  if (lifecycleState === 'starting' || lifecycleState === 'created') return 'active';
  if (jobStatus === 'succeeded') return 'active';
  return 'pending';
}

function deriveLiveState(status: string): MicroStepState {
  if (status === 'ready') return 'done';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function buildSteps(input: BuildMicrostepsInput): MicroStep[] {
  return [
    {
      key: 'build',
      label: 'Build',
      Icon: Hammer,
      state: deriveBuildState(input.jobStatus),
    },
    {
      key: 'boot',
      label: 'Boot',
      Icon: Power,
      state: deriveBootState(input.jobStatus, input.agentStatus),
    },
    {
      key: 'setup',
      label: 'Setup',
      Icon: Cog,
      state: deriveSetupState(input.jobStatus, input.lifecycleState),
    },
    {
      key: 'live',
      label: 'Live',
      Icon: Zap,
      state: deriveLiveState(input.status),
    },
  ];
}

function stateClasses(state: MicroStepState): { wrap: string; icon: string } {
  switch (state) {
    case 'done':
      return {
        wrap: 'text-emerald-600 dark:text-emerald-400',
        icon: '',
      };
    case 'active':
      return {
        wrap: 'text-primary font-medium',
        icon: 'animate-spin',
      };
    case 'failed':
      return {
        wrap: 'text-destructive',
        icon: '',
      };
    case 'pending':
    default:
      return {
        wrap: 'text-muted-foreground/60',
        icon: 'opacity-60',
      };
  }
}

function StepBadge({ step }: { step: MicroStep }): React.ReactElement {
  const cls = stateClasses(step.state);
  // Active steps: spinner replaces the icon for a clear "in progress" cue.
  // Done steps: keep the original icon and overlay a tiny check chip on the right.
  // Failed steps: swap to AlertTriangle.
  let IconNode: React.ReactNode;
  if (step.state === 'active') {
    IconNode = <Loader2 className={cn('h-3.5 w-3.5', cls.icon)} aria-hidden="true" />;
  } else if (step.state === 'failed') {
    IconNode = <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
  } else if (step.state === 'done') {
    IconNode = (
      <span className="relative inline-flex">
        <step.Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <Check
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500/90 p-px text-white"
          aria-hidden="true"
          strokeWidth={3}
        />
      </span>
    );
  } else {
    IconNode = <step.Icon className={cn('h-3.5 w-3.5', cls.icon)} aria-hidden="true" />;
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1', cls.wrap)}
      title={`${step.label}: ${step.state}`}
    >
      {IconNode}
      <span>{step.label}</span>
    </span>
  );
}

export interface BuildMicrostepsProps extends BuildMicrostepsInput {
  className?: string;
  /** Optional click handler — useful when "failed" surfaces a "click to view" CTA. */
  onFailedClick?: () => void;
}

export default function BuildMicrosteps({
  status,
  jobStatus,
  agentStatus,
  lifecycleState,
  className,
  onFailedClick,
}: BuildMicrostepsProps): React.ReactElement | null {
  // Hide entirely when the workspace is live — the stats strip carries the
  // visual weight then.
  if (status === 'ready') return null;

  if (status === 'failed') {
    const content = (
      <span className="inline-flex items-center gap-1 text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Build failed</span>
        {onFailedClick && (
          <span className="text-muted-foreground"> — click to view</span>
        )}
      </span>
    );
    if (onFailedClick) {
      return (
        <button
          type="button"
          onClick={onFailedClick}
          className={cn(
            'inline-flex items-center text-xs hover:underline focus:outline-none focus-visible:underline',
            className,
          )}
        >
          {content}
        </button>
      );
    }
    return (
      <span className={cn('inline-flex items-center text-xs', className)}>{content}</span>
    );
  }

  const steps = buildSteps({ status, jobStatus, agentStatus, lifecycleState });

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}
      aria-label="Provisioning progress"
    >
      {steps.map((step, i) => (
        <span key={step.key} className="inline-flex items-center gap-1.5">
          <StepBadge step={step} />
          {i < steps.length - 1 && (
            <ChevronRight
              className="h-2.5 w-2.5 text-muted-foreground/40"
              aria-hidden="true"
            />
          )}
        </span>
      ))}
    </div>
  );
}
