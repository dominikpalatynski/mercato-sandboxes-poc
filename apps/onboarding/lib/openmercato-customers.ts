import {
  createOpenMercatoClient,
  type OpenMercatoClient,
  type OpenMercatoEnv,
} from '@/lib/openmercato-client';

export interface OpenMercatoCustomerScope {
  tenantId: string;
  organizationId: string;
}

export interface SyncOpenMercatoSignupCustomerInput {
  email: string;
  firstName: string;
  lastName: string;
}

export interface SyncOpenMercatoSignupCustomerResult {
  entityId: string;
  personId: string;
  created: boolean;
}

interface OpenMercatoPeopleListResponse {
  items?: Array<{
    id?: string | null;
  }>;
}

interface OpenMercatoPersonDetailResponse {
  profile?: {
    id?: string | null;
  } | null;
}

interface OpenMercatoCreatePersonResponse {
  entityId: string;
  personId: string;
}

export interface OpenMercatoCustomerSyncDependencies {
  client?: Pick<OpenMercatoClient, 'get' | 'post'>;
  env?: OpenMercatoEnv;
}

export function resolveOpenMercatoCustomerScope(
  env: OpenMercatoEnv = process.env as OpenMercatoEnv,
): OpenMercatoCustomerScope | null {
  const tenantId = env.OPENMERCATO_CUSTOMER_TENANT_ID?.trim() ?? '';
  const organizationId = env.OPENMERCATO_CUSTOMER_ORGANIZATION_ID?.trim() ?? '';

  if (!tenantId && !organizationId) {
    return null;
  }

  if (!tenantId || !organizationId) {
    throw new Error(
      'Open Mercato customer sync requires both OPENMERCATO_CUSTOMER_TENANT_ID and OPENMERCATO_CUSTOMER_ORGANIZATION_ID.',
    );
  }

  return {
    tenantId,
    organizationId,
  };
}

function buildDisplayName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter((value) => value.length > 0).join(' ');
}

async function findExistingCustomer(
  client: Pick<OpenMercatoClient, 'get'>,
  email: string,
): Promise<{ entityId: string; personId: string } | null> {
  const list = await client.get<OpenMercatoPeopleListResponse>('/api/customers/people', {
    query: {
      email,
      page: 1,
      pageSize: 1,
    },
  });

  const entityId = list.items?.[0]?.id?.trim();
  if (!entityId) {
    return null;
  }

  const detail = await client.get<OpenMercatoPersonDetailResponse>(
    `/api/customers/people/${encodeURIComponent(entityId)}`,
  );
  const personId = detail.profile?.id?.trim();
  if (!personId) {
    throw new Error(
      `Open Mercato person ${entityId} exists but detail response is missing profile.id.`,
    );
  }

  return { entityId, personId };
}

export async function syncOpenMercatoSignupCustomer(
  input: SyncOpenMercatoSignupCustomerInput,
  deps: OpenMercatoCustomerSyncDependencies = {},
): Promise<SyncOpenMercatoSignupCustomerResult | null> {
  const scope = resolveOpenMercatoCustomerScope(deps.env);
  if (!scope) {
    return null;
  }

  const client = deps.client ?? createOpenMercatoClient();
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  const existing = await findExistingCustomer(client, email);
  if (existing) {
    return {
      ...existing,
      created: false,
    };
  }

  const created = await client.post<
    OpenMercatoCreatePersonResponse,
    Record<string, string>
  >('/api/customers/people', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    firstName,
    lastName,
    displayName: buildDisplayName(firstName, lastName),
    primaryEmail: email,
    source: 'sandbox_onboarding',
  });

  return {
    entityId: created.entityId,
    personId: created.personId,
    created: true,
  };
}
