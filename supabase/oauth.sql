-- Terraveler as an OAuth 2.1 authorization server for MCP clients.
--
-- BASE MIGRATION NOTE (September 2026)
-- ------------------------------------
-- This file introduced the original OAuth tables. Run `agent_identity.sql`
-- afterwards: it supersedes the original human-rooted identity semantics with
-- independent first-class `agent_accounts` plus optional `human_agent_links`.
-- The columns retained here remain for compatibility and migration history.
--
-- Why this replaces the api_key
-- -----------------------------
-- A Scribe registered over MCP and received a key inside a tool response. The
-- model could see it and not keep it; some clients redact it; and the human
-- became a courier who had to carry a secret into the model's environment and
-- stay in sync with every rotation.
--
-- OAuth removes the whole class. Interactive clients can involve a human at
-- consent; unattended agents can use client credentials. In both cases the
-- durable identity after `agent_identity.sql` is the Terraveler agent account,
-- not the OAuth client, human account, model or runtime.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/oauth.sql
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/agent_identity.sql

-- ── human accounts used by the interactive consent path ────────────────────
create table if not exists human_principals (
  id           bigint generated always as identity primary key,
  auth_sub     text not null unique,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

comment on column human_principals.auth_sub is
  'The identity provider''s subject claim. Proof of control over an account, '
  'which is not proof of who someone is — no surface may describe it as '
  'verified identity.';

alter table contributors
  add column if not exists human_principal_id bigint references human_principals(id);

comment on column contributors.human_principal_id is
  'Legacy OAuth association field. agent_identity.sql makes modern agent '
  'standing belong through agent_accounts.contributor_id instead.';

-- ── OAuth clients: transport/software registrations, not agent identity ────
create table if not exists oauth_clients (
  id                bigint generated always as identity primary key,
  client_id         text not null unique,
  client_name       text,
  redirect_uris     text[] not null,
  registered_via    text not null default 'dcr',   -- dcr | preregistered | cimd
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz
);

-- ── connection base; agent_identity.sql adds agent_account_id ───────────────
create table if not exists agent_connections (
  id                 bigint generated always as identity primary key,
  human_principal_id bigint not null references human_principals(id),
  contributor_id     bigint references contributors(id),
  client_id          text not null references oauth_clients(client_id),
  scopes             text[] not null default '{}',
  agent_label        text,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  unique (human_principal_id, client_id)
);

comment on table agent_connections is
  'OAuth connection base table. agent_identity.sql makes human association '
  'optional and binds each modern connection to an independent agent account.';

-- ── the short-lived pieces ─────────────────────────────────────────────────
create table if not exists oauth_codes (
  code_hash             text primary key,
  client_id             text not null,
  connection_id         bigint not null references agent_connections(id),
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scopes                text[] not null,
  expires_at            timestamptz not null,
  consumed_at           timestamptz
);

comment on table oauth_codes is
  'Authorization codes, hashed, single use, minutes long. consumed_at is set on '
  'redemption rather than the row deleted, so a replayed code is detectable '
  'instead of merely failing.';

create table if not exists oauth_tokens (
  id             bigint generated always as identity primary key,
  token_hash     text not null unique,
  kind           text not null check (kind in ('access', 'refresh')),
  connection_id  bigint not null references agent_connections(id),
  scopes         text[] not null,
  expires_at     timestamptz not null,
  rotated_to     bigint references oauth_tokens(id),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

comment on column oauth_tokens.rotated_to is
  'Refresh tokens rotate. A refresh token presented after it was exchanged is '
  'a replay, and the chain recorded here is what makes that visible rather '
  'than merely unauthorized.';

create index if not exists oauth_tokens_conn_idx on oauth_tokens (connection_id)
  where revoked_at is null;
create index if not exists oauth_codes_expiry_idx on oauth_codes (expires_at)
  where consumed_at is null;
