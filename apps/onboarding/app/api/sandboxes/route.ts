import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { sandboxes } from '@/db/schema';
import { requireSessionFromRequest } from '@/lib/auth';
import { OmBillingError } from '@/lib/om-billing';
import {
  ACTIVE_SANDBOX_PRESET_IDS,
  DEFAULT_SANDBOX_PRESET,
  type CreatableSandboxPresetId,
} from '@/lib/sandbox-presets';
import { SandboxQuotaError } from '@/lib/sandbox-quota';
import { sandboxService, SandboxProvisioningError } from '@/lib/sandbox-service';

export async function GET(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }
  const rows = await db
    .select({
      id: sandboxes.id,
      name: sandboxes.name,
      preset_id: sandboxes.presetId,
      status: sandboxes.status,
      status_message: sandboxes.statusMessage,
      coder_workspace_id: sandboxes.coderWorkspaceId,
      created_at: sandboxes.createdAt,
      updated_at: sandboxes.updatedAt,
    })
    .from(sandboxes)
    .where(eq(sandboxes.userId, session.sub))
    .orderBy(desc(sandboxes.createdAt));
  return NextResponse.json({ sandboxes: rows });
}

const Body = z.object({
  name: z.string().regex(/^[a-z0-9-]{3,32}$/, {
    message: 'Name must be 3-32 chars, lowercase letters, digits and dashes only.',
  }),
  preset_id: z.enum(ACTIVE_SANDBOX_PRESET_IDS).default(DEFAULT_SANDBOX_PRESET),
});

function billingErrorResponse(error: OmBillingError): NextResponse {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}

function quotaErrorResponse(error: SandboxQuotaError): NextResponse {
  return NextResponse.json(
    {
      error: error.message,
      code: error.code,
      quota: error.quota,
    },
    { status: error.status },
  );
}

function provisioningErrorResponse(error: SandboxProvisioningError): NextResponse {
  return NextResponse.json(
    { id: error.sandboxId, error: error.message },
    { status: error.status },
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSessionFromRequest(req);
  } catch (resp) {
    if (resp instanceof NextResponse) return resp;
    throw resp;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid name' },
      { status: 400 },
    );
  }
  const name = parsed.data.name;
  const presetId: CreatableSandboxPresetId = parsed.data.preset_id;

  try {
    const result = await sandboxService.createSandbox({
      userId: session.sub,
      name,
      presetId,
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SandboxQuotaError) {
      return quotaErrorResponse(error);
    }
    if (error instanceof SandboxProvisioningError) {
      return provisioningErrorResponse(error);
    }
    if (error instanceof OmBillingError) {
      return billingErrorResponse(error);
    }
    throw error;
  }
}
