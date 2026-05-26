import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { sandboxes, users } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { passwordForOwner } from '@/lib/gitea/client';
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
      giteaOrgName: users.giteaOrgName,
    })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);

  const giteaOrgName = user?.giteaOrgName ?? null;
  // Deterministic password — same value the bridge route uses to log the
  // user into Gitea. Exposing it here lets the credentials fallback panel
  // show a working username/password pair for terminal `git clone` and for
  // signing into Gitea manually if the auto-bridge fails.
  const giteaPassword = giteaOrgName ? passwordForOwner(giteaOrgName) : null;

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
    gitea_org_name: giteaOrgName,
    created_at: sandbox.createdAt ? sandbox.createdAt.toISOString() : null,
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
        giteaPassword={giteaPassword}
      />
    </div>
  );
}
