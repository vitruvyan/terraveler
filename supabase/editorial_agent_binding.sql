-- Apply AFTER editorial_workflow.sql and editorial_team.sql on canonical VPS
-- PostgreSQL. Do not reapply those older function definitions afterwards.
-- Every attempt uses one frozen agent configuration; current pause/role changes
-- revoke permission without rewriting that historical configuration.
begin;

create table if not exists public.editorial_task_agents (
 task_id bigint primary key references public.editorial_tasks(id),
 agent_version_id bigint not null references public.editorial_agent_versions(id),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists editorial_task_agents_version_idx on public.editorial_task_agents(agent_version_id);
drop trigger if exists editorial_task_agent_immutable on public.editorial_task_agents;
create trigger editorial_task_agent_immutable before update or delete or truncate
 on public.editorial_task_agents for each statement execute function public.editorial_append_only();
alter table public.editorial_task_agents enable row level security;
revoke all on public.editorial_task_agents from public,terraveler_service;
grant select on public.editorial_task_agents to terraveler_service;
drop policy if exists editorial_task_agent_service_read on public.editorial_task_agents;
create policy editorial_task_agent_service_read on public.editorial_task_agents
 for select to terraveler_service using(true);

-- Internal helper. Caller holds the task row lock. The shared identity lock
-- serializes authority checks against desk_save_editorial_agent. Returned
-- instructions/model belong to the frozen version, never the latest version.
create or replace function public.editorial_bound_agent(p_task_id bigint,p_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare frozen public.editorial_agent_versions; current_agent public.editorial_agent_versions; begin
 select v.* into frozen from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id where b.task_id=p_task_id;
 if not found or frozen.role<>p_role then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||frozen.agent_key,0));
 select * into current_agent from public.editorial_agent_versions where agent_key=frozen.agent_key order by version desc limit 1;
 if not found or not current_agent.enabled or current_agent.role<>p_role then return null; end if;
 return jsonb_build_object('agent_key',frozen.agent_key,'version',frozen.version,'name',frozen.name,'role',frozen.role,'model',frozen.model,'instructions',frozen.instructions);
end $$;
revoke all on function public.editorial_bound_agent(bigint,text) from public,terraveler_service;

create or replace function public.editorial_claim(p_worker text,p_roles text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; candidate record; chosen public.editorial_agent_versions; bound_key text; cfg jsonb; context jsonb; begin
 if p_worker is null or length(trim(p_worker)) not between 1 and 160 or p_roles is null or cardinality(p_roles)=0 or array_position(p_roles,null) is not null
 or not p_roles <@ array['research','writer','reviewer']::text[] or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid claim'; end if;
 for t in select x.* from public.editorial_tasks x where x.state='queued' and x.role=any(p_roles) and x.attempt<x.max_attempts
   and (x.dependency_id is null or exists(select 1 from public.editorial_tasks dep where dep.id=x.dependency_id and dep.state='completed'))
   and (
     exists(select 1 from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id
       join public.editorial_agents_current c on c.agent_key=v.agent_key where b.task_id=x.id and v.role=x.role and c.enabled and c.role=x.role)
     or (not exists(select 1 from public.editorial_task_agents b where b.task_id=x.id)
       and exists(select 1 from public.editorial_agents_current c where c.enabled and c.role=x.role))
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
   for candidate in select agent_key from public.editorial_agents_current where enabled and role=t.role order by agent_key loop
    if not pg_try_advisory_xact_lock(hashtextextended('editorial-agent:'||candidate.agent_key,0)) then continue; end if;
    -- Resolve again after the lock; a pause/edit may have committed while the
    -- candidate view was read. Pin the authoritative version at this instant.
    select * into chosen from public.editorial_agent_versions where agent_key=candidate.agent_key order by version desc limit 1;
    if not found or not chosen.enabled or chosen.role<>t.role then continue; end if;
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
  return to_jsonb(t)||context||jsonb_build_object('agent_config',cfg);
 end loop;
 return null;
end $$;

create or replace function public.editorial_renew(p_task_id bigint,p_token uuid,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; cfg jsonb; begin
 if p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid lease'; end if;
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_token then return false; end if;
 cfg:=public.editorial_bound_agent(t.id,t.role);
 if cfg is null then return false; end if;
 if t.lease_expires_at<=clock_timestamp() then return false; end if;
 update public.editorial_tasks set lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) where id=t.id;
 return true;
end $$;

create or replace function public.editorial_complete(p_task_id bigint,p_token uuid,p_result jsonb,p_trace jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; r public.editorial_results; cfg jsonb; begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or p_trace is null or jsonb_typeof(p_trace) not in ('object','array') then raise exception 'invalid result'; end if;
 if octet_length(p_result::text)>1048576 or octet_length(p_trace::text)>8388608 then raise exception 'result or trace too large'; end if;
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found then raise exception 'task not found'; end if;
 select * into r from public.editorial_results where task_id=p_task_id;
 if found then
  if r.lease_token is distinct from p_token or r.result is distinct from p_result or r.trace is distinct from p_trace then raise exception 'completion conflict'; end if;
  -- Receipt lookup only: a later pause does not erase an accepted result.
  return jsonb_build_object('result_id',r.id,'replayed',true);
 end if;
 if t.state<>'running' or t.lease_token is distinct from p_token then raise exception 'stale lease'; end if;
 cfg:=public.editorial_bound_agent(t.id,t.role);
 if cfg is null then raise exception 'agent unavailable'; end if;
 -- Check database time after both task and authority locks have been acquired.
 if t.lease_expires_at<=clock_timestamp() then raise exception 'stale lease'; end if;
 insert into public.editorial_results(task_id,lease_token,result,trace) values(p_task_id,p_token,p_result,p_trace) returning * into r;
 insert into public.editorial_task_events(task_id,event,attempt,worker,detail)
  values(t.id,'completed',t.attempt,t.worker,jsonb_build_object('agent_key',cfg->>'agent_key','agent_version',cfg->'version'));
 update public.editorial_tasks set state='completed',worker=null,lease_token=null,lease_expires_at=null where id=t.id;
 return jsonb_build_object('result_id',r.id,'replayed',false);
end $$;

revoke all on function public.editorial_claim(text,text[],integer) from public,terraveler_service;
revoke all on function public.editorial_renew(bigint,uuid,integer) from public,terraveler_service;
revoke all on function public.editorial_complete(bigint,uuid,jsonb,jsonb) from public,terraveler_service;
grant execute on function public.editorial_claim(text,text[],integer),public.editorial_renew(bigint,uuid,integer),public.editorial_complete(bigint,uuid,jsonb,jsonb) to terraveler_service;
notify pgrst,'reload schema';
commit;
