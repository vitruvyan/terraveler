-- Versioned prompt registry: the prose the desk hands an agent (or the human
-- copying it into their own assistant) lived as template literals scattered
-- across two files (lib/chartroom.ts, components/AtlasSearch.tsx). It went
-- stale invisibly at least once this session — an onboarding prompt missing
-- an autonomy instruction, found only after a real agent got stuck on it —
-- and every edit needed a code change and a deploy.
--
-- Append-only, same discipline as audit_log and source_policy_decisions: a
-- prompt is never overwritten, only superseded by a new version that can be
-- compared against the one it replaced. "Current" is simply the highest
-- version number for a given key.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

create table if not exists agent_prompts (
  id bigint generated always as identity primary key,
  prompt_key text not null check (prompt_key in (
    'client_compatibility_preamble', 'onboarding', 'proposal', 'source_proposal', 'contribution'
  )),
  version integer not null check (version > 0),
  body text not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (prompt_key, version)
);

create index if not exists agent_prompts_key_version_idx
  on agent_prompts (prompt_key, version desc);

create or replace function agent_prompts_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception
    'agent_prompts is append-only: % refused. Edit by inserting a new '
    'version, not by changing or removing an old one.', tg_op;
end $$;

drop trigger if exists agent_prompts_append_only on agent_prompts;
create trigger agent_prompts_append_only
  before update or delete on agent_prompts
  for each row execute function agent_prompts_is_append_only();

drop trigger if exists agent_prompts_no_truncate on agent_prompts;
create trigger agent_prompts_no_truncate
  before truncate on agent_prompts
  for each statement execute function agent_prompts_is_append_only();

-- The current text for every key, one row per key, no callers need to know
-- how "current" is computed.
create or replace view agent_prompts_current as
select distinct on (prompt_key) *
from agent_prompts
order by prompt_key, version desc;

commit;
