'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
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
    <Card>
      <form onSubmit={onSubmit}>
        <CardHeader className="space-y-2">
          <CardTitle>Create a new sandbox</CardTitle>
          <CardDescription>
            Provisioning typically takes 2-4 minutes once you submit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="^[a-z0-9-]{3,32}$"
              required
              autoComplete="off"
              placeholder="my-sandbox"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              lowercase, digits, and dashes (3-32 chars)
            </p>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create sandbox'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
