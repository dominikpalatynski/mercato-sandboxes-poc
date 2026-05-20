-- Keep this file in sync with apps/onboarding/db/schema.sql.
-- Mercato Sandboxes - onboarding DB schema
-- Per .ai/SPEC.md §2 data model. Idempotent.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  coder_user_id uuid,
  coder_username text,
  created_at timestamptz default now()
);

alter table users add column if not exists coder_temp_password text;
alter table users add column if not exists first_name text;
alter table users add column if not exists last_name text;
alter table users add column if not exists company_name text;
alter table users add column if not exists accepted_terms_at timestamptz;

create table if not exists sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  preset_id text not null default 'crm',
  coder_workspace_id uuid,
  status text not null default 'pending',
  status_message text,
  vscode_url text,
  terminal_url text,
  app_url text,
  splash_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table sandboxes add column if not exists preset_id text not null default 'crm';

create index if not exists sandboxes_user_id_idx on sandboxes(user_id);

create table if not exists billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  provider_order_id text unique,
  status text not null,
  plan_type text not null,
  amount_pln numeric(12,2) not null,
  credits_usd numeric(12,2) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  paid_at timestamptz
);

create index if not exists billing_orders_user_id_created_at_idx
  on billing_orders(user_id, created_at desc);

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null unique,
  order_id uuid references billing_orders(id) on delete set null,
  event_type text not null,
  payload_json jsonb not null,
  processed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists billing_events_order_id_created_at_idx
  on billing_events(order_id, created_at desc);

create table if not exists llm_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  provider text not null,
  openrouter_key_hash text not null unique,
  openrouter_key_label text not null,
  status text not null,
  coder_secret_sync_state text not null,
  limit_usd numeric(12,2) not null,
  limit_reset text,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists llm_accounts_status_user_id_idx
  on llm_accounts(status, user_id);

create table if not exists llm_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  llm_account_id uuid not null references llm_accounts(id) on delete cascade,
  usage_total_usd numeric(12,2) not null,
  usage_monthly_usd numeric(12,2) not null,
  limit_remaining_usd numeric(12,2) not null,
  observed_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists llm_usage_snapshots_account_observed_at_idx
  on llm_usage_snapshots(llm_account_id, observed_at desc);
