'use client';

import { useEffect, useRef, useState } from 'react';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';

import { cn } from '@/lib/utils';

interface MetadataItem {
  key: string;
  display_name: string;
  value: string;
  collected_at: string | null;
  age_seconds: number | null;
}

interface StatsResponse {
  cpu: MetadataItem | null;
  memory: MetadataItem | null;
  diskHome: MetadataItem | null;
}

interface Props {
  sandboxId: string;
  /** When false, polling is paused — useful for the dashboard while a workspace is still building. */
  enabled: boolean;
  /** Layout: `compact` for dashboard cards, `wide` for the detail page. */
  variant?: 'compact' | 'wide';
  /** Refresh interval in ms (default 5000 per task spec). */
  intervalMs?: number;
  className?: string;
}

const DEFAULT_INTERVAL = 5_000;

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  // `coder stat cpu` returns e.g. "12% 0.42 cores", `coder stat mem` -> "1.2/16 GB",
  // `coder stat disk` -> "12/64 GB". Try percent first, then ratio.
  const pct = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Math.min(100, Math.max(0, Number(pct[1])));
  const ratio = value.match(/^\s*([\d.]+)\s*\/\s*([\d.]+)/);
  if (ratio) {
    const used = Number(ratio[1]);
    const total = Number(ratio[2]);
    if (total > 0) return Math.min(100, Math.max(0, (used / total) * 100));
  }
  return null;
}

function shortValue(value: string | undefined): string {
  if (!value) return '—';
  // First whitespace-trimmed chunk is the headline (e.g. "12%", "1.2/16").
  return value.trim().split(/\s+/).slice(0, 2).join(' ');
}

interface StatRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  pct: number | null;
  variant: 'compact' | 'wide';
}

function StatRow({ icon: Icon, label, value, pct, variant }: StatRowProps): React.ReactElement {
  const barColor =
    pct === null
      ? 'bg-muted-foreground/40'
      : pct > 85
        ? 'bg-red-500'
        : pct > 60
          ? 'bg-amber-500'
          : 'bg-emerald-500';
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums">{value}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto font-mono text-sm tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all duration-500', barColor)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}

export default function WorkspaceStats({
  sandboxId,
  enabled,
  variant = 'compact',
  intervalMs = DEFAULT_INTERVAL,
  className,
}: Props): React.ReactElement | null {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick(): Promise<void> {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/sandboxes/${sandboxId}/stats`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as StatsResponse;
          if (!stoppedRef.current) {
            setStats(data);
            setLoaded(true);
          }
        }
      } catch {
        /* swallow */
      }
      if (!stoppedRef.current) timer = setTimeout(tick, intervalMs);
    }
    void tick();
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [sandboxId, enabled, intervalMs]);

  if (!enabled) return null;

  const cpu = stats?.cpu;
  const mem = stats?.memory;
  const disk = stats?.diskHome;

  const cpuPct = parsePercent(cpu?.value);
  const memPct = parsePercent(mem?.value);
  const diskPct = parsePercent(disk?.value);

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex flex-col gap-1 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs',
          !loaded && 'opacity-60',
          className,
        )}
        aria-label="Live workspace stats"
      >
        <StatRow
          icon={Cpu}
          label="CPU"
          value={shortValue(cpu?.value)}
          pct={cpuPct}
          variant="compact"
        />
        <StatRow
          icon={MemoryStick}
          label="RAM"
          value={shortValue(mem?.value)}
          pct={memPct}
          variant="compact"
        />
        <StatRow
          icon={HardDrive}
          label="Disk"
          value={shortValue(disk?.value)}
          pct={diskPct}
          variant="compact"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-3',
        className,
      )}
      aria-label="Live workspace stats"
    >
      <StatRow
        icon={Cpu}
        label={cpu?.display_name || 'CPU usage'}
        value={shortValue(cpu?.value)}
        pct={cpuPct}
        variant="wide"
      />
      <StatRow
        icon={MemoryStick}
        label={mem?.display_name || 'RAM usage'}
        value={shortValue(mem?.value)}
        pct={memPct}
        variant="wide"
      />
      <StatRow
        icon={HardDrive}
        label={disk?.display_name || 'Home disk'}
        value={shortValue(disk?.value)}
        pct={diskPct}
        variant="wide"
      />
    </div>
  );
}
