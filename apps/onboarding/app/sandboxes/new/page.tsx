import Link from 'next/link';
import { requireSession } from '@/lib/auth';

export default async function NewSandboxPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-semibold">New sandbox</h1>
      <p className="text-gray-400">Coming soon — sandbox provisioning is wired up in task #6.</p>
      <Link href="/dashboard" className="inline-block text-indigo-300 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
