import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { requireActiveBilling } from '@/lib/billing-gate';
import { Button } from '@/components/ui/button';
import NewSandboxForm from './form';
import {
  DEFAULT_SANDBOX_PRESET,
  listCreatableSandboxPresets,
} from '@/lib/sandbox-presets';

export default async function NewSandboxPage() {
  await requireActiveBilling();
  const creatablePresets = listCreatableSandboxPresets();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>
      <NewSandboxForm
        creatablePresets={creatablePresets}
        defaultPresetId={DEFAULT_SANDBOX_PRESET}
      />
    </div>
  );
}
