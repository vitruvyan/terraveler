-- Canonical VPS PostgreSQL. Apply AFTER editorial_plan_dispatch.sql (whose
-- editorial_claim is the live definition, verified token for token).
--
-- Finish dossiers one at a time instead of advancing all of them slowly.
--
-- Workers claimed the lowest task id first. A dossier's automatic revisions are
-- created last, so with eight dossiers queued, Cortes's three rewrites (all
-- dependencies complete) waited behind every task of every later dossier, and a
-- dossier one step from the end sat for ~40 minutes. Claims now take the oldest
-- graph run first, then the lowest id; tasks outside a graph keep run 0, ahead,
-- as before. Nothing else in the function changes.
begin;
create or replace function public.editorial_claim(p_worker text,p_roles text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; candidate record; chosen public.editorial_agent_versions; bound_key text; cfg jsonb; context jsonb; begin
 if p_worker is null or length(trim(p_worker)) not between 1 and 160 or p_roles is null or cardinality(p_roles)=0 or array_position(p_roles,null) is not null
 or not p_roles <@ array['research','writer','reviewer']::text[] or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid claim'; end if;
 for t in select x.* from public.editorial_tasks x where x.state='queued' and x.role=any(p_roles) and x.attempt<x.max_attempts
   and (x.dependency_id is null or exists(select 1 from public.editorial_tasks dep where dep.id=x.dependency_id and dep.state='completed'))
   and public.editorial_graph_claimable(x.id)
   and (
     exists(select 1 from public.editorial_task_agents b join public.editorial_agent_versions v on v.id=b.agent_version_id
       join public.editorial_agents_current c on c.agent_key=v.agent_key where b.task_id=x.id and v.role=x.role and c.enabled and c.role=x.role
       and not exists(select 1 from public.editorial_specialist_assignments sa where sa.task_id=x.id and sa.agent_key<>v.agent_key))
     or (not exists(select 1 from public.editorial_task_agents b where b.task_id=x.id)
       and exists(select 1 from public.editorial_agents_current c where c.enabled and c.role=x.role
         and not exists(select 1 from public.editorial_specialist_assignments sa where sa.task_id=x.id and sa.agent_key<>c.agent_key)))
   )
   order by coalesce((select g.run_id from public.editorial_graph_tasks g where g.task_id=x.id),0),x.id
   for update of x skip locked limit 100 loop
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
  return to_jsonb(t)||context||jsonb_build_object('input',t.input||public.editorial_graph_context(t.id),'agent_config',cfg,'specialist_assignment',(select jsonb_build_object('agent_key',sa.agent_key,'specialty',sa.specialty) from public.editorial_specialist_assignments sa where sa.task_id=t.id));
 end loop;
 return null;
end $$;
commit;
