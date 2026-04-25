'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function NewSandboxForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/sandboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      router.push(`/sandboxes/${data.id}`);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-gray-300">Name</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          pattern="^[a-z0-9-]{3,32}$"
          required
          autoComplete="off"
          placeholder="my-sandbox"
          className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
      </label>
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
      >
        {busy ? 'Creating…' : 'Create sandbox'}
      </button>
    </form>
  );
}
