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
import { cn } from '@/lib/utils';
import type {
  CreatableSandboxPresetId,
  SandboxPresetDefinition,
} from '@/lib/sandbox-presets';

interface Props {
  creatablePresets: SandboxPresetDefinition[];
  defaultPresetId: CreatableSandboxPresetId;
}

export default function NewSandboxForm({
  creatablePresets,
  defaultPresetId,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [presetId, setPresetId] = useState<CreatableSandboxPresetId>(defaultPresetId);
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
        body: JSON.stringify({ name, preset_id: presetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        if (data.code === 'ai_entitlement_required') {
          setError('Activate paid AI access on the dashboard before creating a sandbox.');
        } else if (data.code === 'sandbox_limit_reached') {
          setError('Your current plan sandbox limit is reached. Delete an existing sandbox or update the subscription.');
        } else if (data.code === 'sandbox_quota_unavailable') {
          setError('Your current plan does not expose a valid sandbox limit. Open billing and refresh your subscription access.');
        } else {
          setError(data.error || `HTTP ${res.status}`);
        }
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
            Provisioning typically takes 2-4 minutes once you submit. Paid AI access must already
            be active for sandbox creation to start. The chosen preset only affects first boot;
            pause/resume keeps the same workspace data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Sandbox preset</Label>
              <p className="text-xs text-muted-foreground">
                One Coder template, different Open Mercato bootstrap commands on first start.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {creatablePresets.map((preset) => {
                const selected = presetId === preset.id;
                return (
                  <label
                    key={preset.id}
                    className={cn(
                      'cursor-pointer rounded-xl border p-4 transition',
                      selected
                        ? 'border-primary bg-primary/5 shadow-card'
                        : 'border-border hover:border-primary/30 hover:bg-accent/30',
                    )}
                  >
                    <input
                      type="radio"
                      name="preset_id"
                      value={preset.id}
                      checked={selected}
                      onChange={() => setPresetId(preset.id as CreatableSandboxPresetId)}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{preset.displayName}</div>
                        <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                      </div>
                      {selected && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {preset.commandPreview}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

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
