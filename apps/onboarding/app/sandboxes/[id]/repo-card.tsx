'use client';

import type * as React from 'react';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  GitBranch,
  Loader2,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';

// lucide-react v1 doesn't ship a GitHub mark, so inline it. Sized via the
// `className` prop so it matches the rest of the icon set.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface RepoCardProps {
  sandboxId: string;
  repoOrigin: string;
  giteaCloneUrl: string | null;
  githubRepoFullName: string | null;
  githubCloneUrl: string | null;
  githubLogin: string | null;
  githubInstallationId: string | null;
  onMigrated: (next: { githubRepoFullName: string; githubCloneUrl: string }) => void;
}

function stripCreds(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
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

type IconComponent = LucideIcon | React.ComponentType<{ className?: string }>;

function HeaderRow({ icon: Icon, title, subtitle }: { icon: IconComponent; title: string; subtitle: string }) {
  return (
    <div className="flex flex-row items-start gap-3 p-5 pb-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex flex-col">
        <h2 className="text-base font-semibold leading-none">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export default function RepoCard(props: RepoCardProps) {
  const router = useRouter();
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onMigrate = useCallback(async () => {
    setMigrating(true);
    setError(null);
    try {
      const res = await fetch(`/api/sandboxes/${props.sandboxId}/migrate-to-github`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
        githubRepoFullName?: string;
        githubCloneUrl?: string;
      };
      if (!res.ok || !body.ok || !body.githubRepoFullName || !body.githubCloneUrl) {
        setError(body.error || `Migration failed (${res.status})`);
        setMigrating(false);
        return;
      }
      props.onMigrated({
        githubRepoFullName: body.githubRepoFullName,
        githubCloneUrl: body.githubCloneUrl,
      });
      router.refresh();
    } catch (e) {
      setError(String(e).slice(0, 200));
    } finally {
      setMigrating(false);
    }
  }, [props, router]);

  if (props.repoOrigin === 'github' && props.githubRepoFullName && props.githubCloneUrl) {
    const repoUrl = `https://github.com/${props.githubRepoFullName}`;
    const cloneUrl = stripCreds(props.githubCloneUrl) ?? props.githubCloneUrl;
    return (
      <Card className="border-border/80 bg-card/90">
        <HeaderRow
          icon={GithubIcon}
          title="Source repository"
          subtitle={`Hosted on GitHub as ${props.githubRepoFullName}`}
        />
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="rounded bg-background/60 px-2 py-0.5 font-mono text-sm text-foreground">
              {cloneUrl}
            </code>
            <div className="flex items-center gap-2">
              <CopyChip value={cloneUrl} label="Copy GitHub clone URL" />
              <Button asChild size="sm" variant="outline">
                <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open on GitHub
                </a>
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Workspace pushes now go to GitHub. The Gitea mirror was archived
            (not deleted) so historical commits stay reachable.
          </p>
        </CardContent>
      </Card>
    );
  }

  const giteaCloneUrl = stripCreds(props.giteaCloneUrl);
  const githubLinked = Boolean(props.githubInstallationId);

  return (
    <Card className="border-border/80 bg-card/90">
      <HeaderRow
        icon={GitBranch}
        title="Source repository"
        subtitle={
          githubLinked
            ? `Hosted on Mercato Gitea. Ready to migrate to github.com/${props.githubLogin}.`
            : 'Hosted on Mercato Gitea. Link a GitHub account to take ownership.'
        }
      />
      <CardContent className="space-y-4">
        {giteaCloneUrl && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="rounded bg-background/60 px-2 py-0.5 font-mono text-sm text-foreground">
              {giteaCloneUrl}
            </code>
            <CopyChip value={giteaCloneUrl} label="Copy Gitea clone URL" />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between')}>
          <p className="text-xs text-muted-foreground">
            {githubLinked
              ? 'Moving to GitHub mirrors every commit, switches the workspace origin, and archives the Gitea repo.'
              : 'Connecting installs the mercato-agent GitHub App on the account or org you choose.'}
          </p>
          {githubLinked ? (
            <Button type="button" onClick={() => void onMigrate()} disabled={migrating}>
              {migrating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GithubIcon className="h-4 w-4" />
              )}
              {migrating ? 'Migrating…' : 'Move to GitHub'}
            </Button>
          ) : (
            <Button asChild type="button">
              <a href="/api/github/install/start">
                <GithubIcon className="h-4 w-4" />
                Connect GitHub
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
