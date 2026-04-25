import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { requireSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import NewSandboxForm from './form';

export default async function NewSandboxPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>
      <NewSandboxForm />
    </div>
  );
}
