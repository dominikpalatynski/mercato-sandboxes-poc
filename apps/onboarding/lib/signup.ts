import { eq } from 'drizzle-orm';

import { hashPassword, signSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { syncOpenMercatoSignupCustomer } from '@/lib/openmercato-customers';
import { createUserOrg, GiteaApiError } from '@/lib/gitea/client';

export class SignupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SignupError';
  }
}

export interface RegisterUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
}

export interface RegisterUserResult {
  userId: string;
  email: string;
  sessionToken: string;
  openMercatoCustomerEntityId: string | null;
  openMercatoCustomerPersonId: string | null;
}

export interface SignupRepository {
  findUserIdByEmail: (email: string) => Promise<string | null>;
  insertUser: (input: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
    crmEntityId: string | null;
    crmPersonId: string | null;
  }) => Promise<{ id: string; email: string }>;
  setUserGiteaOrg: (userId: string, orgName: string) => Promise<void>;
}

export const defaultSignupRepository: SignupRepository = {
  async findUserIdByEmail(email) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0]?.id ?? null;
  },
  async insertUser(input) {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        acceptedTermsAt: new Date(),
        openMercatoCustomerEntityId: input.crmEntityId,
        openMercatoCustomerPersonId: input.crmPersonId,
      })
      .returning({ id: users.id, email: users.email });
    if (!row) {
      throw new SignupError(500, 'user_create_failed', 'Failed to create user');
    }
    return row;
  },
  async setUserGiteaOrg(userId, orgName) {
    await db.update(users).set({ giteaOrgName: orgName }).where(eq(users.id, userId));
  },
};

export interface RegisterUserDependencies {
  repository?: SignupRepository;
  hashPassword?: typeof hashPassword;
  signSession?: typeof signSession;
  syncOpenMercatoSignupCustomer?: typeof syncOpenMercatoSignupCustomer;
  createUserOrg?: typeof createUserOrg;
}

export async function registerUser(
  input: RegisterUserInput,
  deps: RegisterUserDependencies = {},
): Promise<RegisterUserResult> {
  const repo = deps.repository ?? defaultSignupRepository;
  const hashPasswordImpl = deps.hashPassword ?? hashPassword;
  const signSessionImpl = deps.signSession ?? signSession;
  const syncOpenMercatoSignupCustomerImpl =
    deps.syncOpenMercatoSignupCustomer ?? syncOpenMercatoSignupCustomer;
  const createUserOrgImpl = deps.createUserOrg ?? createUserOrg;

  const email = input.email.toLowerCase().trim();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const companyName = input.companyName?.trim() || null;

  const existingId = await repo.findUserIdByEmail(email);
  if (existingId) {
    throw new SignupError(409, 'email_already_registered', 'Email already registered');
  }

  let crmCustomer: Awaited<ReturnType<typeof syncOpenMercatoSignupCustomerImpl>> = null;
  try {
    crmCustomer = await syncOpenMercatoSignupCustomerImpl({
      email,
      firstName,
      lastName,
    });
  } catch (error) {
    throw new SignupError(
      502,
      'crm_customer_sync_failed',
      'Failed to create CRM customer',
      error,
    );
  }

  const passwordHash = await hashPasswordImpl(input.password);
  const user = await repo.insertUser({
    email,
    passwordHash,
    firstName,
    lastName,
    companyName,
    crmEntityId: crmCustomer?.entityId ?? null,
    crmPersonId: crmCustomer?.personId ?? null,
  });

  // Best-effort: provision the user's Gitea org now so the first sandbox
  // create can skip the round-trip. A Gitea outage must not block signup —
  // the sandbox-create path will retry.
  try {
    const org = await createUserOrgImpl({
      userId: user.id,
      email: user.email,
      fullName: [firstName, lastName].filter(Boolean).join(' ').trim(),
    });
    await repo.setUserGiteaOrg(user.id, org.name);
  } catch (error) {
    if (!(error instanceof GiteaApiError)) {
      console.error('[signup] unexpected error provisioning Gitea org', error);
    } else {
      console.warn('[signup] gitea org provisioning failed; will retry on first sandbox create', {
        status: error.status,
      });
    }
  }

  const sessionToken = await signSessionImpl({ sub: user.id, email: user.email });
  return {
    userId: user.id,
    email: user.email,
    sessionToken,
    openMercatoCustomerEntityId: crmCustomer?.entityId ?? null,
    openMercatoCustomerPersonId: crmCustomer?.personId ?? null,
  };
}
