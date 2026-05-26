'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Info,
  KeyRound,
  Loader2,
  Trash2,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { repoBrowseUrl, stripCreds } from '@/lib/sandbox-ui-helpers';

export interface SettingsPanelProps {
  sandboxId: string;
  sandboxName: string;
  presetLabel: string;
  presetId: string;
  repoOrigin: string | null | undefined;
  createdAt: string | null;
  giteaCloneUrl: string | null;
  giteaOrgName: string | null;
  giteaPassword: string | null;
  coderEmail: string;
  coderTempPassword: string | null;
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* ignore */
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[11px] hover:bg-accent hover:text-accent-foreground"
      aria-label={label}
    >
      <Copy className="h-3 w-3" />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CredentialField({
  label,
  value,
  monospace = true,
  secret = false,
  copyLabel,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  secret?: boolean;
  copyLabel: string;
}) {
  const [show, setShow] = useState(false);
  const display = secret && !show ? '•'.repeat(Math.min(value.length, 16)) : value;
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <code
          className={
            monospace
              ? 'rounded bg-background/60 px-2 py-0.5 font-mono text-foreground'
              : 'rounded bg-background/60 px-2 py-0.5 text-foreground'
          }
        >
          {display}
        </code>
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="inline-flex h-7 items-center justify-center rounded-sm border border-border px-2 hover:bg-accent hover:text-accent-foreground"
            aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        <CopyChip value={value} label={copyLabel} />
      </dd>
    </div>
  );
}

function CredentialsCard({
  storageKey,
  title,
  hint,
  children,
}: {
  storageKey: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const flag = window.sessionStorage.getItem(storageKey);
      if (flag === '1') setOpen(true);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        window.sessionStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <Card className="border-border/80 bg-card/90">
        <CollapsibleTrigger
          className="group flex w-full items-center gap-2 rounded-md p-4 text-left transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={open ? `Hide ${title}` : `Show ${title}`}
        >
          <ChevronRight className="h-4 w-4 text-primary transition-transform group-data-[state=open]:rotate-90" />
          <KeyRound className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold leading-none">{title}</span>
          {hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function SettingsPanel(props: SettingsPanelProps) {
  const router = useRouter();
  const cloneUrl = stripCreds(props.giteaCloneUrl);
  const browseUrl = repoBrowseUrl(props.giteaCloneUrl);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/sandboxes/${props.sandboxId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(body.error || `Delete failed (${res.status})`);
        setDeleting(false);
        return;
      }
      router.push('/dashboard');
    } catch (e) {
      setDeleteError(String(e).slice(0, 200));
      setDeleting(false);
    }
  }, [props.sandboxId, router]);

  const openInGiteaHref = browseUrl
    ? `/api/gitea-login?sandbox_id=${encodeURIComponent(props.sandboxId)}&next=${encodeURIComponent(browseUrl)}`
    : null;

  const createdAtLabel = props.createdAt
    ? new Date(props.createdAt).toLocaleString()
    : '—';

  return (
    <div className="space-y-4">
      {/* 1. Source repository */}
      <Card className="border-border/80 bg-card/90">
        <div className="flex flex-row items-start gap-3 p-5 pb-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-base font-semibold leading-none">Source repository</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your code lives in Mercato Gitea. Open it to browse, clone, or invite collaborators.
            </p>
          </div>
        </div>
        <CardContent>
          {cloneUrl ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="rounded bg-background/60 px-2 py-0.5 font-mono text-sm text-foreground">
                {cloneUrl}
              </code>
              <div className="flex items-center gap-2">
                <CopyChip value={cloneUrl} label="Copy Gitea clone URL" />
                {openInGiteaHref && (
                  <Button asChild size="sm">
                    <a href={openInGiteaHref} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in Gitea
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Repository not provisioned yet.</p>
          )}
        </CardContent>
      </Card>

      {/* 2. Gitea credentials */}
      {props.giteaOrgName && props.giteaPassword && (
        <CredentialsCard
          storageKey={`sandbox-gitea-creds-open:${props.sandboxId}`}
          title="Gitea credentials"
          hint="Sign in directly or use with `git clone`"
        >
          <dl className="space-y-2 text-sm">
            <CredentialField
              label="Username"
              value={props.giteaOrgName}
              copyLabel="Copy Gitea username"
            />
            <CredentialField
              label="Password"
              value={props.giteaPassword}
              secret
              copyLabel="Copy Gitea password"
            />
          </dl>
          <p className="text-xs text-muted-foreground">
            Use these to clone the repo from a terminal or sign in to Gitea directly if the
            auto sign-in button fails. The username is also the name of your personal Gitea
            organization.
          </p>
        </CredentialsCard>
      )}

      {/* 3. Coder credentials */}
      {props.coderTempPassword && (
        <CredentialsCard
          storageKey={`sandbox-coder-creds-open:${props.sandboxId}`}
          title="Coder credentials"
          hint="Fallback if auto sign-in fails"
        >
          <dl className="space-y-2 text-sm">
            <CredentialField
              label="Email"
              value={props.coderEmail}
              copyLabel="Copy Coder email"
            />
            <CredentialField
              label="Temp password"
              value={props.coderTempPassword}
              secret
              copyLabel="Copy Coder password"
            />
          </dl>
          <p className="text-xs text-muted-foreground">
            Use these if Coder asks you to log in. The password is shown only this once.
          </p>
        </CredentialsCard>
      )}

      {/* 4. Sandbox details */}
      <Card className="border-border/80 bg-card/90">
        <div className="flex flex-row items-start gap-3 p-5 pb-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Info className="h-5 w-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-base font-semibold leading-none">Sandbox details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Metadata about this workspace.
            </p>
          </div>
        </div>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <CredentialField
              label="Sandbox ID"
              value={props.sandboxId}
              copyLabel="Copy sandbox ID"
            />
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-mono text-foreground">{props.sandboxName}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Preset</dt>
              <dd className="text-foreground">{props.presetLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Repository origin</dt>
              <dd className="text-foreground">{props.repoOrigin ?? 'gitea'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Created at</dt>
              <dd className="text-foreground">{createdAtLabel}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* 5. Danger zone */}
      <Card className="border-destructive/40 bg-destructive/5">
        <div className="flex flex-row items-start gap-3 p-5 pb-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-base font-semibold leading-none">Danger zone</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deleting a sandbox tears down its Coder workspace and removes its DB record. This cannot be undone.
            </p>
          </div>
        </div>
        <CardContent className="space-y-3">
          {deleteError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
              {deleteError}
            </div>
          )}
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4" />
            Delete sandbox
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={(v) => !deleting && setConfirmDelete(v)}>
        <AlertDialogTitle>Delete this sandbox?</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete the Coder workspace, its volumes, and the sandbox record.
          You will not be able to recover its files.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
        </AlertDialogFooter>
      </AlertDialog>
    </div>
  );
}
