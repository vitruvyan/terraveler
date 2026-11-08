-- Editorial team configuration, not external contributor identities.
-- Apply to canonical VPS PostgreSQL, never the Supabase Auth database.
-- This migration configures agents only: it starts no worker or model call.
begin;

create table if not exists public.editorial_agent_versions (
  id bigint generated always as identity primary key,
  agent_key text not null check(agent_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  version integer not null check(version > 0),
  name text not null check(length(trim(name)) between 1 and 120),
  role text not null check(role in ('coordinator','research','writer','reviewer')),
  model text not null check(length(trim(model)) between 1 and 200),
  instructions text not null check(length(trim(instructions)) between 1 and 12000),
  enabled boolean not null,
  request_id text unique not null check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  request_value jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(agent_key,version)
);
create index if not exists editorial_agent_versions_current_idx
  on public.editorial_agent_versions(agent_key,version desc);

create or replace function public.editorial_team_append_only() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'editorial agent history is append-only'; end;
$$;
drop trigger if exists editorial_agent_history_immutable on public.editorial_agent_versions;
create trigger editorial_agent_history_immutable
before update or delete or truncate on public.editorial_agent_versions
for each statement execute function public.editorial_team_append_only();

-- Invoker security keeps the underlying RLS effective for every reader.
create or replace view public.editorial_agents_current with (security_invoker=true) as
select distinct on (agent_key) id,agent_key,version,name,role,model,instructions,enabled,created_at
from public.editorial_agent_versions order by agent_key,version desc;

create or replace function public.desk_save_editorial_agent(
 p_agent_key text,p_name text,p_role text,p_model text,p_instructions text,
 p_enabled boolean,p_expected_version integer,p_request_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
 prior public.editorial_agent_versions;
 current_version integer;
 value jsonb;
begin
 if p_agent_key is null or p_agent_key !~ '^[a-z0-9][a-z0-9-]{1,79}$'
 or p_name is null or length(trim(p_name)) not between 1 and 120
 or p_role is null or p_role not in ('coordinator','research','writer','reviewer')
 or p_model is null or length(trim(p_model)) not between 1 and 200
 or p_model ~ E'[\r\n]'
 or p_instructions is null or length(trim(p_instructions)) not between 1 and 12000
 or p_enabled is null or p_expected_version is null or p_expected_version not between 0 and 2147483646
 or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then
   return jsonb_build_object('error','invalid-agent');
 end if;
 value:=jsonb_build_object('agent_key',p_agent_key,'name',trim(p_name),'role',p_role,
   'model',trim(p_model),'instructions',trim(p_instructions),'enabled',p_enabled,'expected_version',p_expected_version);
 -- Request then identity: repeated requests and competing edits serialize
 -- before comparing versions. Every invocation takes locks in this order.
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent-request:'||p_request_id,0));
 select * into prior from public.editorial_agent_versions where request_id=p_request_id;
 if found then
   if prior.request_value is distinct from value then
     return jsonb_build_object('error','idempotency-conflict');
   end if;
   return jsonb_build_object('agent_key',prior.agent_key,'version',prior.version,'replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||p_agent_key,0));
 select coalesce(max(version),0) into current_version
   from public.editorial_agent_versions where agent_key=p_agent_key;
 if current_version<>p_expected_version then
   return jsonb_build_object('error','conflict','current_version',current_version);
 end if;
 insert into public.editorial_agent_versions(agent_key,version,name,role,model,instructions,enabled,request_id,request_value)
 values(p_agent_key,current_version+1,trim(p_name),p_role,trim(p_model),trim(p_instructions),p_enabled,p_request_id,value);
 return jsonb_build_object('agent_key',p_agent_key,'version',current_version+1,'replayed',false);
end;
$$;

alter table public.editorial_agent_versions enable row level security;
revoke all on public.editorial_agent_versions,public.editorial_agents_current from public,terraveler_service;
grant select on public.editorial_agent_versions,public.editorial_agents_current to terraveler_service;
drop policy if exists editorial_team_service_read on public.editorial_agent_versions;
create policy editorial_team_service_read on public.editorial_agent_versions
for select to terraveler_service using(true);
revoke all on function public.editorial_team_append_only() from public,terraveler_service;
revoke all on function public.desk_save_editorial_agent(text,text,text,text,text,boolean,integer,text) from public,terraveler_service;
grant execute on function public.desk_save_editorial_agent(text,text,text,text,text,boolean,integer,text) to terraveler_service;
notify pgrst,'reload schema';
commit;
