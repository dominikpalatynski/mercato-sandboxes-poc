import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { sandboxes, users } from '@/db/schema';
import { Button } from '@/components/ui/button';
import StatusPoller, { type SandboxView } from './status-poller';
import type { SandboxPresetId } from '@/lib/sandbox-presets';

export const dynamic = 'force-dynamic';

export default async function SandboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const coderPublicUrl = (
    process.env.CODER_PUBLIC_URL || 'https://coder.sandbox.lvh.me'
  ).replace(/\/$/, '');
  const session = await requireSession();
  const { id } = await params;

  const [sandbox] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, id), eq(sandboxes.userId, session.sub)))
    .limit(1);
  if (!sandbox) notFound();

  const [user] = await db
    .select({
      email: users.email,
      coderTempPassword: users.coderTempPassword,
      coderUsername: users.coderUsername,
      githubLogin: users.githubLogin,
      githubInstallationId: users.githubInstallationId,
    })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);

  const initial: SandboxView = {
    id: sandbox.id,
    name: sandbox.name,
    preset_id: sandbox.presetId as SandboxPresetId,
    status: sandbox.status,
    status_message: sandbox.statusMessage,
    vscode_url: sandbox.vscodeUrl,
    terminal_url: sandbox.terminalUrl,
    app_url: sandbox.appUrl,
    splash_url: sandbox.splashUrl,
    coder_owner_name: user?.coderUsername ?? null,
    coder_workspace_name: sandbox.name,
    repo_origin: sandbox.repoOrigin,
    gitea_clone_url: sandbox.giteaCloneUrl,
    github_repo_full_name: sandbox.githubRepoFullName,
    github_clone_url: sandbox.githubCloneUrl,
    github_login: user?.githubLogin ?? null,
    github_installation_id: user?.githubInstallationId ?? null,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-0 py-2 md:px-2">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>
      <StatusPoller
        initial={initial}
        coderEmail={user?.email ?? session.email}
        coderTempPassword={user?.coderTempPassword ?? null}
        coderPublicUrl={coderPublicUrl}
      />
    </div>
  );
}
