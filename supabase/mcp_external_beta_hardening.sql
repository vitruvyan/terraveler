-- Terraveler MCP external-beta admission, replay and security audit state.
-- Apply to the canonical PostgreSQL database on the VPS, never Supabase Auth.
-- Run after agent_identity.sql and mcp_oauth_write_functions.sql.

begin;

alter table oauth_clients add column if not exists source_hash text;
create index if not exists oauth_clients_source_created_idx
  on oauth_clients (source_hash, created_at desc)
  where source_hash is not null;

-- One client_credentials registration represents one connection/runtime.
-- This deliberately fails deployment if historical autonomous duplicates have
-- not been reconciled first; silently choosing one would lose audit history.
create unique index if not exists agent_connections_autonomous_client_key
  on agent_connections (client_id)
  where human_principal_id is null;

create table if not exists mcp_security_rate_limits (
  dimension       text not null,
  subject_hash    text not null,
  action          text not null,
  window_start    timestamptz not null,
  request_count   integer not null check (request_count > 0),
  updated_at      timestamptz not null default now(),
  primary key (dimension, subject_hash, action, window_start)
);

create index if not exists mcp_security_rate_limits_cleanup_idx
  on mcp_security_rate_limits (window_start);

create table if not exists mcp_security_leases (
  lease_key       text primary key,
  request_id      text not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists mcp_security_leases_expiry_idx
  on mcp_security_leases (expires_at);

create table if not exists mcp_security_idempotency (
  agent_account_id bigint not null references agent_accounts(id),
  action            text not null,
  key_hash          text not null,
  request_hash      text not null,
  response_status   integer,
  response_body     jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  primary key (agent_account_id, action, key_hash)
);

create index if not exists mcp_security_idempotency_expiry_idx
  on mcp_security_idempotency (expires_at);

create table if not exists mcp_security_audit (
  id                bigint generated always as identity primary key,
  request_id        text not null,
  agent_id          text,
  agent_account_id  bigint references agent_accounts(id),
  connection_id     bigint references agent_connections(id),
  client_id         text,
  action            text not null,
  outcome           text not null check (outcome in ('accepted', 'rejected', 'failed', 'replayed')),
  http_status       integer not null,
  rejection_reason text,
  source_hash       text,
  network_hash      text,
  created_at        timestamptz not null default now()
);

create index if not exists mcp_security_audit_agent_idx
  on mcp_security_audit (agent_account_id, created_at desc);
create index if not exists mcp_security_audit_action_idx
  on mcp_security_audit (action, created_at desc);

-- One atomic counter per independently enforced dimension. A rejected update
-- returns no row, so concurrent serverless instances cannot all pass a prior
-- count and then write together.
create or replace function mcp_security_consume_limit(
  p_dimension text, p_subject_hash text, p_action text,
  p_window_seconds integer, p_limit integer
) returns table (allowed boolean, used integer, resets_at timestamptz)
language plpgsql
as $$
declare w timestamptz; n integer;
begin
  if p_window_seconds < 1 or p_limit < 1 then
    raise exception 'invalid rate limit configuration';
  end if;
  w := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into mcp_security_rate_limits(dimension, subject_hash, action, window_start, request_count)
  values (p_dimension, p_subject_hash, p_action, w, 1)
  on conflict (dimension, subject_hash, action, window_start) do update
    set request_count = mcp_security_rate_limits.request_count + 1,
        updated_at = now()
    where mcp_security_rate_limits.request_count < p_limit
  returning request_count into n;
  return query select n is not null, coalesce(n, p_limit), w + make_interval(secs => p_window_seconds);
end;
$$;

create or replace function mcp_security_acquire_lease(
  p_lease_key text, p_request_id text, p_ttl_seconds integer
) returns boolean
language plpgsql
as $$
declare acquired text;
begin
  insert into mcp_security_leases(lease_key, request_id, expires_at)
  values (p_lease_key, p_request_id, now() + make_interval(secs => p_ttl_seconds))
  on conflict (lease_key) do update
    set request_id = excluded.request_id, expires_at = excluded.expires_at, created_at = now()
    where mcp_security_leases.expires_at <= now()
       or mcp_security_leases.request_id = excluded.request_id
  returning request_id into acquired;
  return acquired is not null;
end;
$$;

create or replace function mcp_security_release_lease(p_lease_key text, p_request_id text)
returns void language sql as $$
  delete from mcp_security_leases where lease_key = p_lease_key and request_id = p_request_id;
$$;

-- Reserve once, replay the completed response for the same payload, and reject
-- both key reuse with different data and simultaneous in-flight duplicates.
create or replace function mcp_security_begin_idempotent(
  p_agent_account_id bigint, p_action text, p_key_hash text, p_request_hash text
) returns jsonb
language plpgsql
as $$
declare r record;
begin
  select * into r from mcp_security_idempotency
   where agent_account_id = p_agent_account_id and action = p_action and key_hash = p_key_hash
   for update;
  if not found or r.expires_at <= now() then
    delete from mcp_security_idempotency
     where agent_account_id = p_agent_account_id and action = p_action and key_hash = p_key_hash;
    insert into mcp_security_idempotency(agent_account_id, action, key_hash, request_hash)
    values (p_agent_account_id, p_action, p_key_hash, p_request_hash);
    return jsonb_build_object('state', 'reserved');
  end if;
  if r.request_hash <> p_request_hash then
    return jsonb_build_object('state', 'conflict');
  end if;
  if r.completed_at is null then
    return jsonb_build_object('state', 'in_progress');
  end if;
  return jsonb_build_object('state', 'replay', 'status', r.response_status, 'body', r.response_body);
end;
$$;

create or replace function mcp_security_complete_idempotent(
  p_agent_account_id bigint, p_action text, p_key_hash text,
  p_response_status integer, p_response_body jsonb
) returns void language sql as $$
  update mcp_security_idempotency
     set response_status = p_response_status, response_body = p_response_body,
         completed_at = now()
   where agent_account_id = p_agent_account_id and action = p_action and key_hash = p_key_hash;
$$;

revoke all on mcp_security_rate_limits, mcp_security_leases,
  mcp_security_idempotency, mcp_security_audit from public;
revoke execute on function mcp_security_consume_limit(text, text, text, integer, integer) from public;
revoke execute on function mcp_security_acquire_lease(text, text, integer) from public;
revoke execute on function mcp_security_release_lease(text, text) from public;
revoke execute on function mcp_security_begin_idempotent(bigint, text, text, text) from public;
revoke execute on function mcp_security_complete_idempotent(bigint, text, text, integer, jsonb) from public;
grant select, insert, update, delete on mcp_security_rate_limits, mcp_security_leases,
  mcp_security_idempotency, mcp_security_audit to terraveler_service;
grant usage, select on sequence mcp_security_audit_id_seq to terraveler_service;
grant execute on function mcp_security_consume_limit(text, text, text, integer, integer) to terraveler_service;
grant execute on function mcp_security_acquire_lease(text, text, integer) to terraveler_service;
grant execute on function mcp_security_release_lease(text, text) to terraveler_service;
grant execute on function mcp_security_begin_idempotent(bigint, text, text, text) to terraveler_service;
grant execute on function mcp_security_complete_idempotent(bigint, text, text, integer, jsonb) to terraveler_service;

commit;
