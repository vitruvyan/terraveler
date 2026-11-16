-- Canonical VPS PostgreSQL. Apply after editorial_specialists.sql.
-- Nullable specialty preserves legacy configurations; explicit specialties are immutable per version.
begin;
create table if not exists public.editorial_agent_specialties (
 agent_version_id bigint primary key references public.editorial_agent_versions(id),
 requested_specialty text,
 specialty text not null check(specialty in ('managing-editor','history','ethnohistory','itinerary','iconography','diary','caption','editorial','copyedit','factcheck'))
);
drop trigger if exists editorial_agent_specialties_immutable on public.editorial_agent_specialties;
create trigger editorial_agent_specialties_immutable before update or delete or truncate on public.editorial_agent_specialties
 for each statement execute function public.editorial_team_append_only();
alter table public.editorial_agent_specialties enable row level security;
revoke all on public.editorial_agent_specialties from public,terraveler_service;
grant select on public.editorial_agent_specialties to terraveler_service;
drop policy if exists editorial_specialties_service_read on public.editorial_agent_specialties;
create policy editorial_specialties_service_read on public.editorial_agent_specialties for select to terraveler_service using(true);
create or replace view public.editorial_specialist_agents_current with(security_invoker=true) as
 select a.*,s.specialty from public.editorial_agents_current a left join public.editorial_agent_specialties s on s.agent_version_id=a.id;
revoke all on public.editorial_specialist_agents_current from public,terraveler_service;
grant select on public.editorial_specialist_agents_current to terraveler_service;

create or replace function public.desk_save_editorial_specialist_agent(
 p_agent_key text,p_name text,p_role text,p_model text,p_instructions text,
 p_enabled boolean,p_expected_version integer,p_request_id text,p_specialty text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_agent_versions; current_specialty text; effective_specialty text:=p_specialty; receipt jsonb; version_id bigint;
begin
 if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' or p_agent_key is null or p_agent_key !~ '^[a-z0-9][a-z0-9-]{1,79}$' then return jsonb_build_object('error','invalid-agent'); end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent-request:'||p_request_id,0));
 select * into prior from public.editorial_agent_versions where request_id=p_request_id;
 if found then
  select requested_specialty into current_specialty from public.editorial_agent_specialties where agent_version_id=prior.id;
  if p_specialty is distinct from current_specialty then return jsonb_build_object('error','idempotency-conflict'); end if;
  receipt:=public.desk_save_editorial_agent(p_agent_key,p_name,p_role,p_model,p_instructions,p_enabled,p_expected_version,p_request_id);
  if receipt ? 'error' then return receipt; end if;
  return receipt||jsonb_build_object('specialty',(select specialty from public.editorial_agent_specialties where agent_version_id=prior.id));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||p_agent_key,0));
 if effective_specialty is null then
  select s.specialty into effective_specialty from public.editorial_agents_current a join public.editorial_agent_specialties s on s.agent_version_id=a.id where a.agent_key=p_agent_key;
 end if;
 if effective_specialty is not null then
  if public.editorial_specialty_role(effective_specialty) is distinct from p_role then return jsonb_build_object('error','specialty-role-mismatch'); end if;
  if p_enabled and effective_specialty not in ('history','diary','factcheck') then return jsonb_build_object('error','specialist-handler-not-implemented'); end if;
 end if;
 receipt:=public.desk_save_editorial_agent(p_agent_key,p_name,p_role,p_model,p_instructions,p_enabled,p_expected_version,p_request_id);
 if receipt ? 'error' then return receipt; end if;
 if effective_specialty is not null then
  select id into version_id from public.editorial_agent_versions where request_id=p_request_id;
  insert into public.editorial_agent_specialties(agent_version_id,specialty,requested_specialty) values(version_id,effective_specialty,p_specialty);
 end if;
 return receipt||jsonb_build_object('specialty',effective_specialty);
end $$;
revoke all on function public.desk_save_editorial_specialist_agent(text,text,text,text,text,boolean,integer,text,text) from public,terraveler_service;
grant execute on function public.desk_save_editorial_specialist_agent(text,text,text,text,text,boolean,integer,text,text) to terraveler_service;
create or replace function public.editorial_bound_agent(p_task_id bigint,p_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare frozen public.editorial_agent_versions; current_agent public.editorial_agent_versions; begin
 select v.* into frozen from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id where b.task_id=p_task_id;
 if not found or frozen.role<>p_role then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||frozen.agent_key,0));
 select * into current_agent from public.editorial_agent_versions where agent_key=frozen.agent_key order by version desc limit 1;
 if not found or not current_agent.enabled or current_agent.role<>p_role then return null; end if;
 if exists(select 1 from public.editorial_specialist_assignments a join public.editorial_agent_specialties s on s.agent_version_id=current_agent.id where a.task_id=p_task_id and s.specialty<>a.specialty) then return null; end if;
 return jsonb_build_object('agent_key',frozen.agent_key,'version',frozen.version,'name',frozen.name,'role',frozen.role,'model',frozen.model,'instructions',frozen.instructions);
end $$;
revoke all on function public.editorial_bound_agent(bigint,text) from public,terraveler_service;

create or replace function public.editorial_assign_specialist(p_task_id bigint,p_agent_key text,p_specialty text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare existing public.editorial_specialist_assignments; t public.editorial_tasks;
 current_agent public.editorial_agent_versions; expected_role text; begin
 if p_agent_key is null or p_agent_key !~ '^[a-z0-9][a-z0-9-]{1,79}$'
   or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'invalid specialist assignment'; end if;
 expected_role:=public.editorial_specialty_role(p_specialty);
 if expected_role is null then raise exception 'unknown specialty'; end if;
 -- Recognizing a catalogue entry does not make its tools available.
 if p_specialty not in ('history','diary','factcheck') then raise exception 'specialist handler not implemented'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-specialist-request:'||p_request_id,0));
 select * into existing from public.editorial_specialist_assignments where request_id=p_request_id;
 if found then
  if existing.task_id is distinct from p_task_id or existing.agent_key is distinct from p_agent_key or existing.specialty is distinct from p_specialty then raise exception 'specialist idempotency conflict'; end if;
  return jsonb_build_object('task_id',existing.task_id,'agent_key',existing.agent_key,'specialty',existing.specialty,'replayed',true);
 end if;
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found then raise exception 'task not found'; end if;
 if exists(select 1 from public.editorial_specialist_assignments where task_id=p_task_id) then raise exception 'task already assigned'; end if;
 if t.state<>'queued' or t.attempt<>0 or exists(select 1 from public.editorial_task_agents where task_id=p_task_id) then raise exception 'task already claimed'; end if;
 if t.role<>expected_role then raise exception 'specialty role mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||p_agent_key,0));
 select * into current_agent from public.editorial_agent_versions where agent_key=p_agent_key order by version desc limit 1;
 if not found or not current_agent.enabled or current_agent.role<>expected_role then raise exception 'specialist agent unavailable'; end if;
 if exists(select 1 from public.editorial_agent_specialties where agent_version_id=current_agent.id and specialty<>p_specialty) then raise exception 'specialty configuration mismatch'; end if;
 insert into public.editorial_specialist_assignments(task_id,agent_key,specialty,request_id)
  values(p_task_id,p_agent_key,p_specialty,p_request_id);
 insert into public.editorial_task_events(task_id,event,attempt,detail)
  values(p_task_id,'specialist-assigned',0,jsonb_build_object('agent_key',p_agent_key,'specialty',p_specialty));
 return jsonb_build_object('task_id',p_task_id,'agent_key',p_agent_key,'specialty',p_specialty,'replayed',false);
end $$;
revoke all on function public.editorial_assign_specialist(bigint,text,text,text) from public,terraveler_service;
grant execute on function public.editorial_assign_specialist(bigint,text,text,text) to terraveler_service;

create or replace function public.editorial_claim(p_worker text,p_roles text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; candidate record; chosen public.editorial_agent_versions; bound_key text; cfg jsonb; context jsonb; begin
 if p_worker is null or length(trim(p_worker)) not between 1 and 160 or p_roles is null or cardinality(p_roles)=0 or array_position(p_roles,null) is not null
 or not p_roles <@ array['research','writer','reviewer']::text[] or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid claim'; end if;
 for t in select x.* from public.editorial_tasks x where x.state='queued' and x.role=any(p_roles) and x.attempt<x.max_attempts
   and (x.dependency_id is null or exists(select 1 from public.editorial_tasks dep where dep.id=x.dependency_id and dep.state='completed'))
   and (
     exists(select 1 from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id
       join public.editorial_agents_current c on c.agent_key=v.agent_key where b.task_id=x.id and v.role=x.role and c.enabled and c.role=x.role
       and not exists(select 1 from public.editorial_specialist_assignments sa where sa.task_id=x.id and sa.agent_key<>v.agent_key))
     or (not exists(select 1 from public.editorial_task_agents b where b.task_id=x.id)
       and exists(select 1 from public.editorial_agents_current c where c.enabled and c.role=x.role
         and not exists(select 1 from public.editorial_specialist_assignments sa where sa.task_id=x.id and sa.agent_key<>c.agent_key)))
   )
   order by x.id for update of x skip locked limit 100 loop
  cfg:=null;
  select v.agent_key into bound_key from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id where b.task_id=t.id;
  if found then
   -- Nonblocking while scanning: a skipped candidate must not create a lock
   -- cycle with another claim that scans a different task/agent combination.
   if not pg_try_advisory_xact_lock(hashtextextended('editorial-agent:'||bound_key,0)) then continue; end if;
   cfg:=public.editorial_bound_agent(t.id,t.role);
  else
   for candidate in select agent_key from public.editorial_agents_current where enabled and role=t.role
     and not exists(select 1 from public.editorial_specialist_assignments sa where sa.task_id=t.id and sa.agent_key<>editorial_agents_current.agent_key)
     order by agent_key loop
    if not pg_try_advisory_xact_lock(hashtextextended('editorial-agent:'||candidate.agent_key,0)) then continue; end if;
    -- Resolve again after the lock; a pause/edit may have committed while the
    -- candidate view was read. Pin the authoritative version at this instant.
    select * into chosen from public.editorial_agent_versions where agent_key=candidate.agent_key order by version desc limit 1;
    if not found or not chosen.enabled or chosen.role<>t.role then continue; end if;
    if exists(select 1 from public.editorial_specialist_assignments a join public.editorial_agent_specialties s on s.agent_version_id=chosen.id where a.task_id=t.id and s.specialty<>a.specialty) then continue; end if;
    insert into public.editorial_task_agents(task_id,agent_version_id) values(t.id,chosen.id);
    insert into public.editorial_task_events(task_id,event,attempt,worker,detail)
     values(t.id,'agent-bound',t.attempt,p_worker,jsonb_build_object('agent_key',chosen.agent_key,'version',chosen.version));
    cfg:=public.editorial_bound_agent(t.id,t.role);
    exit;
   end loop;
  end if;
  if cfg is null then continue; end if;
  update public.editorial_tasks set state='running',attempt=attempt+1,worker=p_worker,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) where id=t.id returning * into t;
  insert into public.editorial_task_events(task_id,event,attempt,worker,detail) values(t.id,'claimed',t.attempt,p_worker,jsonb_build_object('lease_token',t.lease_token,'agent_key',cfg->>'agent_key','agent_version',cfg->'version'));
  select jsonb_build_object('topic',to_jsonb(d),'sources',coalesce((select jsonb_agg(snapshot order by submission_id) from public.editorial_topic_submissions where topic_id=t.topic_id),'[]'::jsonb),
    'dependency_result',(select result from public.editorial_results where task_id=t.dependency_id)) into context from public.editorial_topics d where d.id=t.topic_id;
  return to_jsonb(t)||context||jsonb_build_object('agent_config',cfg,'specialist_assignment',(select jsonb_build_object('agent_key',sa.agent_key,'specialty',sa.specialty) from public.editorial_specialist_assignments sa where sa.task_id=t.id));
 end loop;
 return null;
end $$;

revoke all on function public.editorial_claim(text,text[],integer) from public,terraveler_service;
grant execute on function public.editorial_claim(text,text[],integer) to terraveler_service;
-- All service writes must use the specialty-aware wrapper; legacy RPC remains owner-internal.
revoke execute on function public.desk_save_editorial_agent(text,text,text,text,text,boolean,integer,text) from terraveler_service;
notify pgrst,'reload schema';
commit;
