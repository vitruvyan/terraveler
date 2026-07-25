-- Terraveler governance hardening — v1
-- Run in the Supabase SQL editor AFTER governance_schema.sql.
-- Adds: per-contributor API keys (stored hashed), contributor status
-- (suspension), and gap-claim ownership with expiry.

-- ---------------------------------------------------------------- contributors
alter table contributors
  add column if not exists api_key_hash text,
  add column if not exists status text not null default 'active'
    check (status in ('active','suspended'));

create unique index if not exists contributors_api_key_hash_idx
  on contributors (api_key_hash) where api_key_hash is not null;

-- ---------------------------------------------------------------- gap claims
-- Claims now carry an owner and a timestamp; stale claims (no follow-up
-- within the TTL enforced by the MCP server) are reopened lazily.
alter table editorial_gaps
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz;

-- ---------------------------------------------------------------- legacy handles
-- Contributors registered before personal keys have api_key_hash = null and
-- cannot write until the desk mints them a key:
--   create extension if not exists pgcrypto;
--   -- 1. generate:  select encode(gen_random_bytes(24), 'hex');
--   -- 2. store:     update contributors
--   --                 set api_key_hash = encode(digest('THE-KEY', 'sha256'), 'hex')
--   --                 where handle = 'the-handle';
--   -- 3. hand THE-KEY to the contributor privately; it is never stored in clear.
