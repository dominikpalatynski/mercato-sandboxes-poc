'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowUpRight, MonitorCog, Trash2 } from 'lucide-react';

import StatusBadge from '@/components/status-badge';
import WorkspaceStats from '@/components/workspace-stats';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatRelative } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

export interface DashboardSandbox {
  id: string;
  name: string;
  status: string;
  status_message: string | null;
  created_at: string;
}

interface Props {
  initial: DashboardSandbox[];
}

export default function SandboxCards({ initial }: Props): React.ReactElement {
  const [items, setItems] = useState<DashboardSandbox[]>(initial);
  const [pendingDelete, setPendingDelete] = useState<DashboardSandbox | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/sandboxes', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { sandboxes: DashboardSandbox[] };
        setItems(data.sandboxes);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    const target = pendingDelete;
    // Optimistic remove
    setItems((prev) => prev.filter((s) => s.id !== target.id));
    try {
      const res = await fetch(`/api/sandboxes/${target.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        setError(`Delete failed (${res.status})`);
        // Re-sync from server on error
        await refresh();
      }
    } catch (e) {
      setError(String(e).slice(0, 200));
      await refresh();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, refresh]);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">No sandboxes yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Spin up a fresh Open Mercato development environment in a couple of minutes.
        </p>
        <Link
          href="/sandboxes/new"
          className="mt-4 inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create your first sandbox
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <ul className="space-y-3">
        {items.map((s) => (
          <li
            key={s.id}
            className={cn(
              'group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-card',
              'sm:flex-row sm:items-center',
            )}
          >
            {/* Computer icon */}
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <MonitorCog className="h-7 w-7" />
            </span>

            {/* Name + status + relative time */}
            <div className="min-w-0 flex-1 space-y-1">
              <Link
                href={`/sandboxes/${s.id}`}
                className="block truncate font-mono text-base font-semibold text-foreground hover:underline"
              >
                {s.name}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={s.status} />
                <span>created {formatRelative(s.created_at)}</span>
                {s.status_message && (
                  <span className="truncate">· {s.status_message}</span>
                )}
              </div>
            </div>

            {/* Live stats — only when ready */}
            <WorkspaceStats
              sandboxId={s.id}
              enabled={s.status === 'ready'}
              variant="compact"
              className="w-full sm:w-56"
            />

            {/* Actions */}
            <div className="flex items-center gap-1.5 self-start sm:self-center">
              <Button asChild size="sm" variant="default">
                <Link href={`/sandboxes/${s.id}`} aria-label={`Open ${s.name}`}>
                  <ArrowUpRight className="h-4 w-4" />
                  Open
                </Link>
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Delete ${s.name}`}
                onClick={() => setPendingDelete(s)}
                className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogTitle>Delete sandbox?</AlertDialogTitle>
        <AlertDialogDescription>
          This permanently removes the workspace, code, and database
          {pendingDelete ? ` for ` : '. '}
          {pendingDelete && (
            <span className="font-mono text-foreground">{pendingDelete.name}</span>
          )}
          . This cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirmDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete sandbox'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
        </AlertDialogFooter>
      </AlertDialog>
    </>
  );
}
