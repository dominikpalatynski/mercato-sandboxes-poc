import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import NewSandboxForm from './form';

export default async function NewSandboxPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New sandbox</h1>
        <p className="text-sm text-gray-400">
          Pick a name (3-32 chars: lowercase letters, digits, dashes). The workspace will start
          provisioning right after you submit; this typically takes 2-4 minutes.
        </p>
      </div>
      <NewSandboxForm />
      <Link href="/dashboard" className="inline-block text-sm text-indigo-300 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
