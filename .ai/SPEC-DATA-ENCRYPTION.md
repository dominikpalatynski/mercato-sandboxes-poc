# Spec: User Data Encryption at Rest

Date: 2026-05-27
Status: Draft
Scope: Alpha
Driver: [Alpha_requirements.md](Alpha_requirements.md) point 7 — "szyfrowanie danych
osobowych w bazie userów, testy OWASP".
Reference implementation: `external/openmercato` —
`packages/shared/src/lib/encryption/*`,
`packages/core/src/modules/customers/encryption.ts`.

## Purpose

Encrypt all personally identifiable information (PII) and operational secrets
stored in the onboarding database so that:

- a stolen database dump (or backup) is useless without access to the KMS;
- GDPR "right to be forgotten" is satisfiable through crypto-shredding
  (deleting a user's DEK) instead of mutating the rest of the data plane;
- closing OWASP A02 (Cryptographic Failures) lands before the alpha launch.

The design copies the envelope-encryption pattern proven in Open Mercato and
adapts the *scope* (tenant → user) and the *ORM integration* (MikroORM
subscribers → Drizzle repo wrappers).

## Decisions

- Encryption is **field-level**, not column-level pgcrypto and not full-disk.
  Field-level keeps the schema small, lets us hash-for-lookup selectively, and
  matches the `external/openmercato` precedent.
- The cipher is **AES-256-GCM** with a random 12-byte IV per write and the
  authentication tag stored alongside the ciphertext, encoded as
  `base64(iv):base64(ct):base64(tag):v1` — identical to
  `external/openmercato/packages/shared/src/lib/encryption/aes.ts`.
- Keys follow **envelope encryption**: a master key lives in the KMS, the KMS
  holds one Data Encryption Key (DEK) per user, the DEK encrypts row values.
- The DEK scope is **per user**, not per tenant or global. This is the only
  meaningful change versus Open Mercato. Rationale: GDPR delete becomes a
  single Vault unlink; one stolen DEK does not compromise other users.
- The KMS is **HashiCorp Vault** (KV v2), running in the same k3s/Hetzner
  cluster as the onboarding service. Path convention: `secret/data/user_key_<userId>`.
- A **derived-key fallback** (PBKDF2-SHA512, 310 000 iterations, salt =
  `userId`) is allowed only in non-production environments and only when Vault
  is unreachable. The fallback is announced loudly in logs, same banner pattern
  as `external/openmercato/packages/shared/src/lib/encryption/kms.ts`.
- Field-level encryption is gated by a runtime feature flag
  (`USER_DATA_ENCRYPTION_ENABLED`). The flag exists so the rollout can be
  staged on a live database without downtime.
- Searches over encrypted columns go through a **deterministic lookup hash**
  (`sha256(lower(trim(value)))`) in a sibling `*_hash` column. `unique`
  constraints migrate from the plaintext column to the hash column.
- All reads of tables containing encrypted columns go through repository
  functions. Direct `db.select().from(<encrypted_table>)` in feature code is a
  lint-blocked anti-pattern.
- `passwordHash` (bcrypt) is **not** subject to this spec — it is a one-way
  hash already, re-encrypting it would add no value.
- The legacy plain-text `coderTempPassword` column is treated as a known
  incident: it is migrated under this spec and overwritten in place during the
  backfill phase.

## In Scope

- field classification across `users`, `billing_orders`, `billing_events`,
  `llm_accounts`, `llm_usage_snapshots`, `sandboxes`;
- introduction of `UserDataEncryptionService`, `KmsService` (Vault + derived
  fallback + noop), and `*WithDecryption` repo helpers in
  `apps/onboarding/lib/encryption/*`;
- a static encryption field map shared between repo helpers and the backfill
  CLI;
- schema migrations adding `*_hash` columns and moving unique constraints;
- a phased, idempotent backfill CLI;
- a hook into user creation that provisions a DEK before the first encrypted
  write;
- a hook into user deletion that unlinks the DEK (crypto-shredding) as the
  GDPR delete primitive.

## Out of Scope (Alpha)

- column-level pgcrypto, transparent disk encryption, transit-level TLS
  hardening — handled elsewhere;
- encryption of data *inside* the user's sandbox volume — a separate concern
  belonging to the sandbox/Coder layer, not the onboarding DB;
- HMAC-with-pepper lookup hashes — the deterministic SHA-256 hash is
  acceptable for alpha and can be upgraded under the `v2` payload tag without
  re-encrypting `v1` rows;
- replacing the existing CRM-side OpenMercato encryption — that already exists
  on its own keys and is not touched here.

## Data Classification

Three risk classes drive whether a field is encrypted, and whether it also
needs a deterministic lookup hash.

| Class | Definition | Examples in this repo | Treatment |
| --- | --- | --- | --- |
| **A — operational secrets** | leak ⇒ direct account takeover | `users.coderTempPassword`, `users.githubInstallationId`, future stored OpenRouter inference keys, future PayByLink secrets | **encrypt**, no hash (never queried by value) |
| **B — PII (GDPR)** | identifies a natural person | `users.email`, `users.firstName`, `users.lastName`, `users.companyName`, `users.githubLogin`, future billing address fields | **encrypt** + lookup hash for fields touched by `unique` or `findBy*` |
| **C — quasi-PII / derived** | may contain PII inside free text or payloads | `billing_events.payload_json`, prompt/response logs if added later, plan/order descriptions if free text is added | **encrypt** selectively, no hash |
| **none** | already one-way, or no PII | `users.passwordHash`, all `id`/FK/timestamp columns, numeric amounts, plan codes, enum-like statuses | unchanged |

Today's `users` table maps cleanly: class A = `coderTempPassword`,
`githubInstallationId`; class B = `email` (also needs hash, has `unique`),
`firstName`, `lastName`, `companyName`, `githubLogin`; everything else stays
in class "none".

`llm_accounts.openrouterKeyHash` is already a hash — keep as-is. Any future
column that holds a raw OpenRouter inference key joins class A.

`billing_events.payload_json` enters class C: encrypted as a single
JSON-serialized blob, no hash, no indexing.

## Architecture

### Module layout (target)

```
apps/onboarding/lib/encryption/
  aes.ts                       # encrypt/decrypt + lookup hash, ports of openmercato aes.ts
  kms.ts                       # VaultKms, DerivedKms, NoopKms, createKmsService()
  service.ts                   # UserDataEncryptionService
  toggles.ts                   # isUserDataEncryptionEnabled(), isDebugEnabled()
  fieldMap.ts                  # static EncryptionFieldMap per table
  repo.ts                      # findWithDecryption / findOneWithDecryption helpers for Drizzle

apps/onboarding/lib/repos/
  users.ts                     # consumes encryption helpers, exports findByEmail etc.
  billingEvents.ts
  llmAccounts.ts
```

### Payload format

A v1 encrypted value is a `text` column matching
`/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:v1$/`. Decryption is
idempotent against this guard so a backfill can safely re-run and a mixed
plaintext/ciphertext column is supported during the rollout window.

### Key hierarchy

1. **Master key** — never leaves Vault. Managed by Vault's KV engine; rotated
   on Vault's own cadence; not exposed to the application.
2. **Per-user DEK** — 32 random bytes, base64. Created lazily on first write
   for that user, cached in-process (with a TTL identical to the openmercato
   default of 15 minutes), stored at `secret/data/user_key_<userId>`.
3. **Row value** — encrypted with the user's DEK using AES-256-GCM.

The DEK never reaches the database. Logs scrub DEKs by construction —
`UserDataEncryptionService` only ever logs `{ userId, fields: n }`, the same
shape as the openmercato debug calls.

### KMS implementations

Three classes, picked at startup by `createKmsService()`:

- `VaultKms` — production. Reads/writes `secret/data/user_key_<userId>`. Same
  HTTP shape as `external/openmercato/packages/shared/src/lib/encryption/kms.ts`
  including the 1 s default request timeout.
- `DerivedKms` — non-production fallback. PBKDF2-SHA512 from a single
  secret env var, salted with `userId`. Deterministic, so a dev instance
  survives restart without persisting keys, **and** never coexists with Vault.
- `NoopKms` — used by tests and by the runtime when
  `USER_DATA_ENCRYPTION_ENABLED=false`. Encryption helpers become passthroughs.

The selection rules and the red-banner log when the fallback engages are
copied verbatim from `openmercato/kms.ts:createKmsService()`.

### Lookup hash

For every class-B field that needs `WHERE field = ?`, a sibling column named
`<snake_case_field>_hash` holds `sha256(lower(trim(value)))` in hex. The
service writes both columns inside the same transaction. Unique constraints
move from the plaintext column to the hash column.

In this repo, only `users.email` (today's `.unique()`) requires a hash for
alpha. `users.githubLogin` gets a hash because we look users up by GitHub
login during the OAuth flow; if that lookup turns out to be unused, the hash
column is dropped before the unique constraint is added.

### Drizzle integration

Drizzle has no ORM-level subscribers, so the encryption boundary is the repo
layer. Two helpers wrap the encrypted tables:

- `findOneWithDecryption(table, where, scope)` — returns a single decrypted
  row, mirrors `external/openmercato/packages/shared/src/lib/encryption/find.ts`.
- `findManyWithDecryption(table, where, scope)` — same for arrays.

Both helpers accept a `scope = { userId }` because the DEK is per user. For
look-up-then-decrypt flows (e.g. login), the repo layer resolves the row by
`email_hash`, reads `user_id`, then calls the helper with that scope.

Writes use a thin `insertEncrypted` / `updateEncrypted` wrapper that:

1. computes lookup hashes for class-B fields with `hashField` declared;
2. encrypts every field listed in the static `EncryptionFieldMap`;
3. delegates to the underlying Drizzle `insert`/`update`.

**Enforcement.** Any direct `db.select().from(users)` (or other encrypted
table) outside of `apps/onboarding/lib/repos/*` is forbidden. The rule is
enforced with a project-local ESLint restriction and a test that greps
`apps/onboarding/**/*.ts` for the forbidden pattern.

### User lifecycle hooks

- **On user create.** Before the first encrypted write, the user-creation
  path calls `encryption.ensureDek(userId)`. With `VaultKms`, this calls
  Vault's KV-write. With `DerivedKms`, this is a no-op (the key is
  deterministic).
- **On user delete.** The hard-delete path calls
  `encryption.shredDek(userId)`. Vault deletes the path; the cache evicts the
  entry. Any remaining encrypted rows become unrecoverable ciphertext, which
  is the desired GDPR semantic.

### Backups

Postgres backups become useless ciphertext without Vault, which means
unencrypted backups can move to cheaper Hetzner storage. Vault must be
backed up separately and on a different rotation. This is mentioned here for
the operational checklist; the actual Vault backup procedure is in the
infra-layer spec.

## Rollout

The rollout is staged so it never demands downtime. Every phase is
re-runnable.

| Phase | What changes | Encryption flag | Reads tolerate plaintext? | Writes encrypt? |
| --- | --- | --- | --- | --- |
| 0 | Repo helpers shipped; all call sites refactored to use repos; helpers are no-ops because the flag is off | off | yes | no |
| 1 | Add `*_hash` columns (nullable). Add new unique indexes as **non-unique** indexes first. Deploy. | off | yes | no |
| 2 | Flip the flag in staging, then production. New writes are encrypted **and** hashed. Reads detect the `v1` suffix and decrypt; plaintext reads remain valid. | on | yes | yes |
| 3 | Run `pnpm onboarding:encryption:backfill` per table. The CLI iterates rows, writes them through the encrypted-update path, idempotent against the `v1` guard. | on | yes | yes |
| 4 | After the backfill finishes and a verifier reports zero plaintext rows, promote `*_hash` indexes to `UNIQUE` and drop the plaintext-column unique constraint. Drop `coderTempPassword` retention by overwriting with `NULL` post-handover. | on | no | yes |

Rollback at any phase up to and including Phase 3 is "flip the flag off"
and continue; rollback after Phase 4 requires restoring the plaintext unique
constraint, which is a deliberate point of no return.

## Implementation Checklist

Backend service:

- [ ] `aes.ts` — `encryptWithAesGcm`, `decryptWithAesGcm`, `hashForLookup`.
- [ ] `kms.ts` — `VaultKms`, `DerivedKms`, `NoopKms`, `createKmsService()`,
      red-banner log on derived fallback.
- [ ] `service.ts` — `UserDataEncryptionService` with per-user DEK cache,
      `encryptEntityPayload`, `decryptEntityPayload`, idempotency guard.
- [ ] `fieldMap.ts` — `{ users: [...], billingEvents: [...] }`,
      `hashField` set only for `email` (and `githubLogin` if confirmed used).
- [ ] `repo.ts` — Drizzle find/insert/update wrappers.
- [ ] Wire `ensureDek` into the user-creation path in `apps/onboarding/app/api`.
- [ ] Wire `shredDek` into the user-deletion path.
- [ ] Lint rule + grep test forbidding direct `db.select().from(users|…)` outside
      `apps/onboarding/lib/repos/*`.

Schema migrations (Drizzle):

- [ ] add `email_hash text` to `users`, non-unique index initially;
- [ ] add `github_login_hash text` to `users` (if lookup is real);
- [ ] no schema change required for class-A/C fields — they stay `text`
      because the ciphertext fits as base64 text;
- [ ] Phase 4 migration: promote `*_hash` indexes to `UNIQUE`, drop the
      plaintext `unique` on `email`.

CLI:

- [ ] `apps/onboarding/scripts/encryption-backfill.ts` with `--table`,
      `--dry-run`, `--batch-size`, idempotent against the `v1` guard,
      tolerant of mixed plaintext/ciphertext rows.
- [ ] `apps/onboarding/scripts/encryption-verify.ts` — scans for plaintext
      rows in encrypted columns, exits non-zero on any hit; gate for the
      Phase 4 migration.

Infrastructure:

- [ ] Vault deployed in the same k3s cluster, two-replica Raft, sealed by
      default;
- [ ] auto-unseal procedure documented (manual unseal acceptable for alpha,
      with a paged runbook);
- [ ] `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_KV_PATH` wired through the
      onboarding deployment env;
- [ ] separate Vault backup schedule;
- [ ] `USER_DATA_ENCRYPTION_ENABLED`, `USER_DATA_ENCRYPTION_FALLBACK_KEY`
      (non-prod only), `USER_DATA_ENCRYPTION_DEBUG` env documented in
      `apps/onboarding/.env.example`.

Tests:

- [ ] unit: roundtrip encrypt/decrypt, double-encrypt idempotency, lookup
      hash determinism;
- [ ] unit: `DerivedKms` is deterministic per `userId`;
- [ ] integration: full create-user → write encrypted row → read decrypted
      row → delete user (shred DEK) → previously-readable row is now
      unreadable ciphertext;
- [ ] integration: login flow resolves by `email_hash`, then decrypts;
- [ ] integration: backfill on a seeded mixed dataset converges in one pass
      and is a no-op on the second pass;
- [ ] OWASP A02 checks added to the alpha security review pass.

## Open Questions

- Does Vault HA on a 4-node Hetzner k3s cluster meet the durability bar for
  alpha, or do we promise a managed Vault Cloud later? Decision needed before
  Phase 2.
- Are billing addresses going to be added before alpha launch? If yes, they
  enter class B and need the same hash-on-lookup treatment for any indexed
  field; if no, they are deferred to a follow-up.
- Should `llm_accounts` carry a future "last 4 chars of inference key" view
  column for the dashboard? If yes, store it as a separate plaintext column,
  not a derivation of the encrypted key.

## Migration Notes

- The `coderTempPassword` rotation is an opportunistic cleanup: during
  backfill, every still-present plaintext value is re-issued (rotated in
  Coder) and the new value is written through the encrypted path. After
  Phase 4, the column is overwritten to `NULL` for any user older than 30
  days.
- The deterministic email hash is a one-way function over normalized input.
  Users who change email casing or surrounding whitespace will still match —
  this is desirable and matches existing case-insensitive login behaviour.
- Encrypted columns remain `text`; no schema change required other than
  adding hash sidecars.
