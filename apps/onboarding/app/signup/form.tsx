'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Signup failed (${res.status})`);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-gray-300">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-white/15 bg-black/30 px-3 py-2"
          autoComplete="email"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-gray-300">Password</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-white/15 bg-black/30 px-3 py-2"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-gray-500">Min 8 characters.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-indigo-500 px-3 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      <p className="text-center text-sm text-gray-400">
        Already have an account? <Link href="/login" className="text-indigo-300 hover:underline">Log in</Link>
      </p>
    </form>
  );
}
