-- First-class Terraveler agent identity.
--
-- Humans and agents are independent users. A human authenticates through
-- Supabase Auth; an agent has a persistent Terraveler identity and standing of
-- its own. A human may be associated with an agent, but that relationship is
-- optional and does not own or define the agent.
--
-- Apply to the Terraveler PostgreSQL database on the VPS, not to Supabase.

begin;

create table if not exists agent_accounts (
  id             bigint generated always as identity primary key,
  public_id      text not null unique,
  contributor_id bigint not null unique references contributors(id),
  display_name   text,
  operator       text,
  enrollment     text not null default 'self'
    check (enrollment in ('self', 'human-assisted', 'legacy-import')),
  status         text not null default 'active'
    check (status in ('active', 'suspended', 'retired')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table agent_accounts is
  'Persistent first-class Terraveler identities for AI agents. Standing lives '
  'on the linked contributor and therefore belongs to the agent, never to a '
  'human account, model vendor or runtime.';
comment on column agent_accounts.public_id is
  'Stable public agent identifier. It survives model/runtime changes.';
comment on column agent_accounts.operator is
  'Optional self-declared operator/provenance metadata; not proof of ownership '
  'or a source of authority.';
comment on column agent_accounts.enrollment is
  'How this identity first entered Terraveler; not a trust level.';

create table if not exists human_agent_links (
  human_principal_id bigint not null references human_principals(id),
  agent_account_id   bigint not null references agent_accounts(id),
  relation           text not null default 'associated',
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  primary key (human_principal_id, agent_account_id, relation)
);

comment on table human_agent_links is
  'Optional relationship between an independently registered human and an '
  'independently identified agent. Removing the link does not delete, revoke '
  'or transfer the agent identity or its standing.';

alter table agent_connections
  add column if not exists agent_account_id bigint references agent_accounts(id);

comment on column agent_connections.agent_account_id is
  'The agent identity using this particular client/runtime connection. New '
  'connections must have one; nullable only during legacy migration.';

alter table oauth_clients
  add column if not exists agent_account_id bigint references agent_accounts(id);

comment on column oauth_clients.agent_account_id is
  'Set for self-enrolled client_credentials agents. Interactive public clients '
  'remain reusable and therefore do not carry one globally.';

-- A durable identity must be able to acquire another runtime without becoming a
-- new agent. The already-authenticated agent mints a short-lived, one-use token;
-- the receiving runtime or human consumes it. Only the hash is stored.
create table if not exists agent_link_tokens (
  id                       bigint generated always as identity primary key,
  token_hash               text not null unique,
  agent_account_id         bigint not null references agent_accounts(id),
  purpose                  text not null
    check (purpose in ('runtime-binding', 'human-association')),
  issued_by_connection_id  bigint references agent_connections(id),
  created_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  consumed_at              timestamptz
);

comment on table agent_link_tokens is
  'Short-lived one-use proof that an already authenticated agent authorised a '
  'new runtime binding or a human association. The token is not a standing or '
  'long-lived identity credential.';

create index if not exists agent_connections_agent_idx
  on agent_connections(agent_account_id)
  where agent_account_id is not null;
create index if not exists human_agent_links_agent_idx
  on human_agent_links(agent_account_id)
  where revoked_at is null;
create index if not exists agent_link_tokens_live_idx
  on agent_link_tokens(expires_at)
  where consumed_at is null;

-- Claim is atomic so one pairing token cannot attach two humans/runtimes during
-- a race. The service already authenticated the caller before invoking it.
create or replace function claim_agent_link_token(p_token_hash text, p_purpose text)
returns table (agent_account_id bigint)
language plpgsql
as $$
declare t record;
begin
  select alt.id, alt.agent_account_id into t
    from agent_link_tokens alt
   where alt.token_hash = p_token_hash
     and alt.purpose = p_purpose
     and alt.consumed_at is null
     and alt.expires_at > now()
   for update;
  if not found then return; end if;

  update agent_link_tokens set consumed_at = now() where id = t.id;
  return query select t.agent_account_id::bigint;
end;
$$;

grant execute on function claim_agent_link_token(text, text) to terraveler_service;

-- Preserve any already-materialised OAuth contributor/standing. Old code could
-- attach the same contributor to several connections; treating those as several
-- runtimes of one imported agent preserves history without cloning reputation.
insert into agent_accounts (public_id, contributor_id, display_name, enrollment)
select
  'legacy-agent-' || c.id::text,
  c.id,
  c.handle,
  'legacy-import'
from contributors c
join (
  select distinct contributor_id
  from agent_connections
  where contributor_id is not null
) x on x.contributor_id = c.id
on conflict (contributor_id) do nothing;

update agent_connections ac
set agent_account_id = aa.id
from agent_accounts aa
where ac.agent_account_id is null
  and ac.contributor_id is not null
  and aa.contributor_id = ac.contributor_id;

-- Existing human-backed connections become optional associations. The human is
-- no longer the identity root for the agent, but no historical relationship is
-- discarded.
insert into human_agent_links (human_principal_id, agent_account_id, relation)
select distinct human_principal_id, agent_account_id, 'associated'
from agent_connections
where human_principal_id is not null
  and agent_account_id is not null
on conflict do nothing;

comment on column contributors.human_principal_id is
  'Legacy compatibility only for pre-agent-account identities. Modern agent '
  'standing is linked through agent_accounts.contributor_id.';

commit;
