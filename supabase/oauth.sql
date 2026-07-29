-- Terraveler as an OAuth 2.1 authorization server for MCP clients.
--
-- Why this replaces the api_key
-- -----------------------------
-- A Scribe registered over MCP and received a key inside a tool response. The
-- model could see it and not keep it; some clients redact it; and the human
-- became a courier who had to carry a secret into the model's environment and
-- stay in sync with every rotation. That last part is not a papercut, it is
-- impossible: the key was rotated twice in one day and the copy the editor had
-- pasted was dead before it was tried.
--
-- OAuth removes the whole class. The client discovers the server, registers
-- itself, opens a browser, the human approves once, and the client holds and
-- refreshes the token. Neither the human nor the model ever handles a secret.
--
-- The identity model, which is the part worth getting right
-- --------------------------------------------------------
-- Registering a client is not identifying a contributor, and conflating the two
-- is how standing ends up belonging to an installation of ChatGPT rather than
-- to a person.
--
--   human_principal   the account that authorised — a Supabase user `sub`
--   contributors      the public handle and its standing (already exists)
--   agent_connection  one client of one principal: ChatGPT, Claude, Claude Code
--   submissions       record which agent and which model did the work
--
-- Standing belongs to the human tandem. Change agent and you keep your
-- reputation; add a second agent and it writes under the same handle. Revoking
-- ChatGPT does not revoke Claude.
--
-- And `human_sponsor` stops being a string the model types. For anyone
-- arriving this way it is the account that clicked approve — with the caveat
-- that OAuth proves control of an account, never the identity of a person, and
-- the copy must not claim otherwise.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/oauth.sql

-- ── the human behind the tandem ────────────────────────────────────────────
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
  'The account this handle belongs to. Null for handles that predate OAuth, '
  'which keep the self-declared human_sponsor string instead.';

-- ── the clients: ChatGPT, Claude, Claude Code, anything else ───────────────
create table if not exists oauth_clients (
  id                bigint generated always as identity primary key,
  client_id         text not null unique,
  client_name       text,
  redirect_uris     text[] not null,
  -- Public clients only. An MCP client is a desktop app or a browser page; it
  -- cannot keep a secret, so PKCE is the proof and there is no client_secret
  -- to leak. RFC 7591 registration is open, which is why it is rate-limited
  -- and every registration is dated and attributed.
  registered_via    text not null default 'dcr',   -- dcr | preregistered | cimd
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz
);

-- ── one agent of one human ─────────────────────────────────────────────────
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
  'One row per agent a person has connected. Revocable one at a time, which is '
  'the point: revoking ChatGPT must not revoke Claude.';

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
