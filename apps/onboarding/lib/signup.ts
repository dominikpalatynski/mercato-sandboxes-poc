import type { QueryResultRow } from 'pg';

import { hashPassword, signSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { syncOpenMercatoSignupCustomer } from '@/lib/openmercato-customers';

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

export interface RegisterUserDependencies {
  query?: typeof query;
  hashPassword?: typeof hashPassword;
  signSession?: typeof signSession;
  syncOpenMercatoSignupCustomer?: typeof syncOpenMercatoSignupCustomer;
}

interface ExistingUserRow extends QueryResultRow {
  id: string;
}

interface InsertedUserRow extends QueryResultRow {
  id: string;
  email: string;
}

export async function registerUser(
  input: RegisterUserInput,
  deps: RegisterUserDependencies = {},
): Promise<RegisterUserResult> {
  const queryImpl = deps.query ?? query;
  const hashPasswordImpl = deps.hashPassword ?? hashPassword;
  const signSessionImpl = deps.signSession ?? signSession;
  const syncOpenMercatoSignupCustomerImpl =
    deps.syncOpenMercatoSignupCustomer ?? syncOpenMercatoSignupCustomer;

  const email = input.email.toLowerCase().trim();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const companyName = input.companyName?.trim() || null;

  const existing = await queryImpl<ExistingUserRow>(
    'select id from users where email = $1',
    [email],
  );
  if (existing.rowCount && existing.rowCount > 0) {
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
  const inserted = await queryImpl<InsertedUserRow>(
    `insert into users (
       email,
       password_hash,
       first_name,
       last_name,
       company_name,
       accepted_terms_at,
       openmercato_customer_entity_id,
       openmercato_customer_person_id
     )
     values ($1, $2, $3, $4, $5, now(), $6, $7)
     returning id, email`,
    [
      email,
      passwordHash,
      firstName,
      lastName,
      companyName,
      crmCustomer?.entityId ?? null,
      crmCustomer?.personId ?? null,
    ],
  );

  const user = inserted.rows[0];
  if (!user) {
    throw new SignupError(500, 'user_create_failed', 'Failed to create user');
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
