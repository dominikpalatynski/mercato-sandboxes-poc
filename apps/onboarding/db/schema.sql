-- Mercato Sandboxes - onboarding DB schema
-- Per SPEC.md §2 data model. Idempotent.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  coder_user_id uuid,
  coder_username text,
  created_at timestamptz default now()
);

-- Postgres 17 supports IF NOT EXISTS on ALTER TABLE ADD COLUMN — idempotent re-runs.
alter table users add column if not exists coder_temp_password text;

create table if not exists sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
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

create index if not exists sandboxes_user_id_idx on sandboxes(user_id);
