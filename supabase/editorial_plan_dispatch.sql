-- Canonical VPS. Apply after all editorial specialties, preparation and corpus migrations.
-- Off by default. Only the three implemented specialist handlers are dispatchable.
begin;
create table if not exists public.editorial_graph_policy(
 singleton boolean primary key default true check(singleton),
 mandatory boolean not null default false
);
insert into public.editorial_graph_policy(singleton) values(true) on conflict do nothing;
create table if not exists public.editorial_graph_runs(
 id bigint generated always as identity primary key,
 topic_id bigint not null references public.editorial_topics(id),
 plan_id bigint not null unique references public.editorial_plans(id),
 request_id text not null unique check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.editorial_graph_tasks(
 task_id bigint primary key references public.editorial_tasks(id),
 run_id bigint not null references public.editorial_graph_runs(id),
 work_item_id text not null,
 unique(run_id,work_item_id)
);
create table if not exists public.editorial_graph_edges(
 task_id bigint not null references public.editorial_graph_tasks(task_id),
 depends_on bigint not null references public.editorial_graph_tasks(task_id),
 primary key(task_id,depends_on), check(task_id<>depends_on)
);
do $$ declare n text; begin
 foreach n in array array['editorial_graph_runs','editorial_graph_tasks','editorial_graph_edges'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_graph_read on public.%I',n);
  execute format('create policy editorial_graph_read on public.%I for select to terraveler_service using(true)',n);
  execute format('drop trigger if exists editorial_graph_immutable on public.%I',n);
  execute format('create trigger editorial_graph_immutable before update or delete or truncate on public.%I for each statement execute function public.editorial_append_only()',n);
 end loop;
end $$;
alter table public.editorial_graph_policy enable row level security;
revoke all on public.editorial_graph_policy from public,terraveler_service;
revoke all on sequence public.editorial_graph_runs_id_seq from public,terraveler_service;

-- Only the database owner may enable the gate in a stopped-worker maintenance
-- window. Existing active legacy work must finish or be explicitly resolved.
create or replace function public.editorial_enable_plan_gate()
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 lock table public.editorial_tasks in share row exclusive mode;
 if exists(select 1 from public.editorial_tasks t where t.state in ('queued','running') and not exists(select 1 from public.editorial_graph_tasks g where g.task_id=t.id))
 then raise exception 'resolve active legacy work before enabling plan gate'; end if;
 update public.editorial_graph_policy set mandatory=true where singleton;
end $$;
revoke all on function public.editorial_enable_plan_gate() from public,terraveler_service;

create or replace function public.editorial_graph_enqueue_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare run public.editorial_graph_runs; item jsonb;
begin
 if not (new.input ? 'graph_run_id') then
  if (select mandatory from public.editorial_graph_policy where singleton) then raise exception 'reviewed editorial plan required'; end if;
  return new;
 end if;
 if coalesce(new.input->>'graph_run_id','') !~ '^[1-9][0-9]{0,17}$' then raise exception 'invalid plan task'; end if;
 select * into run from public.editorial_graph_runs where id=(new.input->>'graph_run_id')::bigint and topic_id=new.topic_id;
 if not found then raise exception 'invalid plan task'; end if;
 select value into item from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items') where p.id=run.plan_id and value->>'id'=new.input->>'work_item_id';
 if item is null or new.task_key<>'graph:'||run.id||':'||(item->>'id') or new.role is distinct from public.editorial_specialty_role(item->>'specialty')
 or new.input is distinct from jsonb_build_object('graph_run_id',run.id,'plan_id',run.plan_id,'work_item_id',item->>'id','work_item',item)
 then raise exception 'invalid plan task'; end if;
 return new;
end $$;
drop trigger if exists editorial_graph_enqueue_gate on public.editorial_tasks;
create trigger editorial_graph_enqueue_gate before insert on public.editorial_tasks for each row execute function public.editorial_graph_enqueue_guard();

create or replace function public.editorial_dispatch_plan(p_topic_id bigint,p_plan_id bigint,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_graph_runs; run public.editorial_graph_runs; plan public.editorial_plans; item jsonb; writer_item jsonb; reviewer_item jsonb;
 t public.editorial_tasks; agent record; selected_id bigint; selected_key text; selected_keys jsonb:='{}'; roles text[]; specialty text; writer_id bigint; n integer; dep text; key text;
begin
 if p_topic_id is null or p_topic_id<=0 or p_plan_id is null or p_plan_id<=0 or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$'
 then raise exception 'invalid dispatch request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-graph-request:'||p_request_id,0));
 select * into prior from public.editorial_graph_runs where request_id=p_request_id;
 if found then
  if prior.topic_id<>p_topic_id or prior.plan_id<>p_plan_id then raise exception 'dispatch idempotency conflict'; end if;
  return jsonb_build_object('run_id',prior.id,'plan_id',prior.plan_id,'replayed',true);
 end if;
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 select * into plan from public.editorial_plans where id=p_plan_id and topic_id=p_topic_id;
 if not found or not exists(select 1 from public.editorial_plan_preparations where plan_id=p_plan_id and review->>'verdict'='adequate-for-next-stage')
 then raise exception 'independently reviewed plan required'; end if;
 if exists(select 1 from public.editorial_plans p where p.topic_id=p_topic_id and p.version>plan.version) then raise exception 'stale plan version'; end if;
 if exists(select 1 from public.editorial_graph_runs g where g.plan_id=p_plan_id) then raise exception 'plan already dispatched'; end if;
 if exists(select 1 from public.editorial_tasks x where x.topic_id=p_topic_id and x.state in ('queued','running'))
 then raise exception 'active work must be resolved'; end if;
 if not exists(select 1 from public.editorial_topic_submissions where topic_id=p_topic_id and snapshot->>'target_voyage' ~ '^[a-z0-9][a-z0-9-]{0,119}$')
 then raise exception 'approved voyage corpus scope required'; end if;
 -- Explicit pilot contract: up to four parallel/dependent historical research
 -- questions, one synthesis, one independent reviewer. Unsupported roles and
 -- unsynthesized research stop dispatch rather than being silently omitted.
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty' not in ('history','diary','factcheck'))
 then raise exception 'specialist handler not implemented'; end if;
 select count(*) into n from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='history';
 if n not between 1 and 4 then raise exception 'one to four research items required'; end if;
 if (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='diary')<>1
 or (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='factcheck')<>1 then raise exception 'one writer and one reviewer required'; end if;
 select value into writer_item from jsonb_array_elements(plan.plan->'work_items') where value->>'specialty'='diary';
 select value into reviewer_item from jsonb_array_elements(plan.plan->'work_items') where value->>'specialty'='factcheck';
 -- Writer explicitly covers every research question; reviewer targets exactly
 -- that draft. Research dependencies are permitted only on other research.
 if jsonb_array_length(writer_item->'depends_on')<>n or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='history' and not (writer_item->'depends_on' ? (v->>'id')))
 or reviewer_item->'depends_on'<>jsonb_build_array(writer_item->>'id')
 or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v cross join lateral jsonb_array_elements_text(v->'depends_on') d where v->>'specialty'='history' and not exists(select 1 from jsonb_array_elements(plan.plan->'work_items') h where h->>'id'=d.value and h->>'specialty'='history'))
 then raise exception 'unsupported editorial dependency graph'; end if;
 -- Require exactly one configured explicit agent per specialty; pin the
 -- version under the same advisory locks used by team configuration.
 for specialty in select unnest(array['history','diary','factcheck']) loop
  select count(*),min(a.id),min(a.agent_key) into n,selected_id,selected_key from public.editorial_specialist_agents_current a where a.specialty=specialty and a.enabled and a.role=public.editorial_specialty_role(specialty);
  if n<>1 then raise exception 'unique enabled specialist required: %',specialty; end if;
  selected_keys:=selected_keys||jsonb_build_object(specialty,jsonb_build_object('id',selected_id,'key',selected_key));
 end loop;
 for key in select value->>'key' from jsonb_each(selected_keys) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||key,0));
 end loop;
 for specialty in select unnest(array['history','diary','factcheck']) loop
  if not exists(select 1 from public.editorial_specialist_agents_current a where a.id=(selected_keys->specialty->>'id')::bigint and a.enabled and a.specialty=specialty)
  then raise exception 'specialist configuration changed'; end if;
 end loop;
 insert into public.editorial_graph_runs(topic_id,plan_id,request_id) values(p_topic_id,p_plan_id,p_request_id) returning * into run;
 -- Research first, writer second, reviewer last, regardless of input ordering.
 for item in select value from jsonb_array_elements(plan.plan->'work_items') order by case value->>'specialty' when 'history' then 1 when 'diary' then 2 else 3 end,value->>'id' loop
  specialty:=item->>'specialty';
  insert into public.editorial_tasks(topic_id,role,task_key,input,dependency_id)
   values(p_topic_id,public.editorial_specialty_role(specialty),'graph:'||run.id||':'||(item->>'id'),
    jsonb_build_object('graph_run_id',run.id,'plan_id',p_plan_id,'work_item_id',item->>'id','work_item',item),
    case when specialty='factcheck' then writer_id else null end) returning * into t;
  if specialty='diary' then writer_id:=t.id; end if;
  insert into public.editorial_graph_tasks(task_id,run_id,work_item_id) values(t.id,run.id,item->>'id');
  insert into public.editorial_task_agents(task_id,agent_version_id) values(t.id,(selected_keys->specialty->>'id')::bigint);
  insert into public.editorial_specialist_assignments(task_id,agent_key,specialty,request_id)
   values(t.id,selected_keys->specialty->>'key',specialty,'graph-assignment-'||t.id);
  insert into public.editorial_task_events(task_id,event,attempt,detail) values(t.id,'queued',0,jsonb_build_object('plan_id',p_plan_id,'work_item_id',item->>'id','agent_version_id',(selected_keys->specialty->>'id')::bigint));
 end loop;
 for item in select value from jsonb_array_elements(plan.plan->'work_items') loop
  for dep in select value from jsonb_array_elements_text(item->'depends_on') loop
   insert into public.editorial_graph_edges(task_id,depends_on)
   select x.task_id,y.task_id from public.editorial_graph_tasks x join public.editorial_graph_tasks y on y.run_id=x.run_id where x.run_id=run.id and x.work_item_id=item->>'id' and y.work_item_id=dep;
  end loop;
 end loop;
 return jsonb_build_object('run_id',run.id,'plan_id',p_plan_id,'replayed',false);
end $$;

create or replace function public.editorial_graph_claimable(p_task_id bigint)
returns boolean language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select case when exists(select 1 from public.editorial_graph_tasks where task_id=p_task_id)
 then exists(select 1 from public.editorial_graph_tasks g join public.editorial_graph_runs r on r.id=g.run_id
  join public.editorial_tasks t on t.id=g.task_id
  join public.editorial_plan_preparations p on p.plan_id=r.plan_id
  where g.task_id=p_task_id and t.topic_id=r.topic_id and t.input->>'plan_id'=r.plan_id::text and p.review->>'verdict'='adequate-for-next-stage'
  and not exists(select 1 from public.editorial_graph_edges e join public.editorial_tasks d on d.id=e.depends_on where e.task_id=g.task_id and d.state<>'completed')
  and not exists(select 1 from public.editorial_graph_tasks sibling join public.editorial_tasks s on s.id=sibling.task_id where sibling.run_id=g.run_id and s.state='attention'))
 else not (select mandatory from public.editorial_graph_policy where singleton) end
$$;

-- Validate exact stored snapshot reference, not merely the presence of a UUID.
-- Recheck the latest live rights decision at each downstream use.
create or replace function public.editorial_graph_check_reference(v jsonb,p_run_id bigint,p_research_task bigint default null,p_attempt integer default null)
returns boolean language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select exists(select 1 from public.editorial_corpus_consultations c
 join public.editorial_graph_tasks g on g.task_id=c.task_id
 cross join lateral jsonb_array_elements(c.snapshot) s
 join public.source_endpoints e on e.id::text=s.value->'governance'->>'endpoint_id'
 join lateral (select d.* from public.source_policy_decisions d where d.endpoint_id=e.id order by d.timestamp desc nulls last,d.id desc limit 1) d on true
 where g.run_id=p_run_id and (p_research_task is null or c.task_id=p_research_task) and (p_attempt is null or c.attempt=p_attempt)
 and c.id::text=v->'governance'->>'mcp_consultation_id' and c.snapshot_sha256=v->'governance'->>'mcp_snapshot_sha256'
 and s.value=(v||jsonb_build_object('governance',(v->'governance')-'mcp_consultation_id'-'mcp_snapshot_sha256'))
 and e.status='active' and e.trust_mode='domain_trusted' and d.id::text=s.value->'governance'->>'policy_decision_id'
 and d.decision_outcome='approve' and d.trust_mode='domain_trusted' and d.rights_class in ('public_domain','creative_commons'))
$$;

create or replace function public.editorial_graph_context(p_task_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare g public.editorial_graph_tasks; t public.editorial_tasks; result jsonb; refs jsonb:='[]'; findings jsonb:='[]'; uncertainties jsonb:='[]'; v jsonb; prior jsonb; research jsonb; draft jsonb; dep_results jsonb;
begin
 select * into g from public.editorial_graph_tasks where task_id=p_task_id;
 if not found then return '{}'::jsonb; end if;
 select * into t from public.editorial_tasks where id=p_task_id;
 if t.role='research' then
  select coalesce(jsonb_agg(jsonb_build_object('work_item_id',p.work_item_id,'result',r.result- 'candidate') order by p.work_item_id),'[]') into dep_results
  from public.editorial_graph_edges e join public.editorial_graph_tasks p on p.task_id=e.depends_on join public.editorial_results r on r.task_id=p.task_id where e.task_id=t.id;
  for result in select value->'result' from jsonb_array_elements(dep_results) loop
   for v in select value from jsonb_array_elements(result->'references') loop
    if not public.editorial_graph_check_reference(v,g.run_id) then raise exception 'source policy changed or receipt invalid'; end if;
   end loop;
  end loop;
  return jsonb_build_object('dependency_research',dep_results);
 end if;
 for result in select r.result from public.editorial_graph_tasks h join public.editorial_tasks x on x.id=h.task_id join public.editorial_results r on r.task_id=x.id where h.run_id=g.run_id and x.role='research' order by h.work_item_id loop
  if result->>'kind' is distinct from 'research' then raise exception 'research result required'; end if;
  for v in select value from jsonb_array_elements(result->'references') loop
   if not public.editorial_graph_check_reference(v,g.run_id) then raise exception 'source policy changed or receipt invalid'; end if;
   select value into prior from jsonb_array_elements(refs) where value->>'id'=v->>'id';
   if not found then refs:=refs||jsonb_build_array(v);
   elsif (prior-'governance') is distinct from (v-'governance') then raise exception 'conflicting source snapshots'; end if;
  end loop;
  findings:=findings||coalesce(result->'findings','[]');
  uncertainties:=uncertainties||coalesce(result->'uncertainties','[]');
 end loop;
 if jsonb_array_length(refs) not between 1 and 40 or jsonb_array_length(findings) not between 1 and 100 or octet_length((refs||findings)::text)>40000 then raise exception 'research synthesis exceeds bounded context'; end if;
 research:=jsonb_build_object('kind','research','references',refs,'findings',findings,'uncertainties',uncertainties);
 if t.role='reviewer' then
  select r.result into draft from public.editorial_results r where r.task_id=t.dependency_id;
  if draft->>'kind' is distinct from 'draft' then raise exception 'draft result required'; end if;
  return jsonb_build_object('research_result',research,'draft_result',draft);
 end if;
 return jsonb_build_object('research_result',research);
end $$;

create or replace function public.editorial_graph_result_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; g public.editorial_graph_tasks; v jsonb; ctx jsonb; refs jsonb;
begin
 select * into t from public.editorial_tasks where id=new.task_id;
 select * into g from public.editorial_graph_tasks where task_id=new.task_id;
 if not found then
  if (select mandatory from public.editorial_graph_policy where singleton) then raise exception 'reviewed editorial plan required'; end if;
  return new;
 end if;
 if not public.editorial_graph_claimable(t.id) then raise exception 'plan task not claimable'; end if;
 if new.result->>'kind' is distinct from case t.role when 'research' then 'research' when 'writer' then 'draft' else 'review' end then raise exception 'wrong plan result kind'; end if;
 if t.role='research' then
  refs:=new.result->'references';
  if jsonb_typeof(refs) is distinct from 'array' then raise exception 'MCP receipts required'; end if;
  if jsonb_array_length(refs) not between 1 and 40 then raise exception 'MCP receipts required'; end if;
  for v in select value from jsonb_array_elements(refs) loop
   if not public.editorial_graph_check_reference(v,g.run_id,t.id,t.attempt) then raise exception 'invalid or revoked MCP receipt'; end if;
  end loop;
 elsif t.role in ('writer','reviewer') then
  ctx:=public.editorial_graph_context(t.id);
  if t.role='writer' and new.result->'references' is distinct from ctx->'research_result'->'references' then raise exception 'draft provenance mismatch'; end if;
  if t.role='reviewer' and coalesce(new.result->>'verdict','') not in ('ready-for-editor','changes-requested','blocked') then raise exception 'invalid review verdict'; end if;
 end if;
 return new;
end $$;
drop trigger if exists editorial_graph_result_gate on public.editorial_results;
create trigger editorial_graph_result_gate before insert on public.editorial_results for each row execute function public.editorial_graph_result_guard();

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
  return to_jsonb(t)||context||jsonb_build_object('input',t.input||public.editorial_graph_context(t.id),'agent_config',cfg,'specialist_assignment',(select jsonb_build_object('agent_key',sa.agent_key,'specialty',sa.specialty) from public.editorial_specialist_assignments sa where sa.task_id=t.id));
 end loop;
 return null;
end $$;

-- Grant only the dispatch port. Internal checks are called by the fenced
-- worker functions or triggers, not by contributors.
revoke all on function public.editorial_dispatch_plan(bigint,bigint,text) from public,terraveler_service;
grant execute on function public.editorial_dispatch_plan(bigint,bigint,text) to terraveler_service;
create or replace view public.editorial_graph_status with(security_invoker=true) as
 select g.id,g.topic_id,g.plan_id,g.request_id,g.created_at,
 case when bool_or(t.state='attention') then 'attention'
  when bool_and(t.state='completed') then
   case when bool_or(t.role='reviewer' and r.result->>'verdict'='ready-for-editor') then 'awaiting-editor' else 'attention' end
  when bool_or(t.state='running') then 'running' else 'queued' end as state,
 count(*)::integer as task_count,count(*) filter(where t.state='completed')::integer as completed_count
 from public.editorial_graph_runs g join public.editorial_graph_tasks m on m.run_id=g.id
 join public.editorial_tasks t on t.id=m.task_id left join public.editorial_results r on r.task_id=t.id group by g.id;
revoke all on public.editorial_graph_status from public,terraveler_service;
grant select on public.editorial_graph_status to terraveler_service;
do $$ declare r text; n text; p record; begin
 for p in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('editorial_graph_enqueue_guard','editorial_graph_claimable','editorial_graph_check_reference','editorial_graph_context','editorial_graph_result_guard') loop
 execute format('revoke all on function %s from public,terraveler_service',p.signature);
 end loop;
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
 if exists(select 1 from pg_roles where rolname=r) then
  foreach n in array array['editorial_graph_policy','editorial_graph_runs','editorial_graph_tasks','editorial_graph_edges','editorial_graph_status'] loop execute format('revoke all on public.%I from %I',n,r); end loop;
  execute format('revoke all on sequence public.editorial_graph_runs_id_seq from %I',r);
  for p in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('editorial_enable_plan_gate','editorial_graph_enqueue_guard','editorial_graph_claimable','editorial_graph_check_reference','editorial_graph_context','editorial_graph_result_guard','editorial_dispatch_plan') loop
   execute format('revoke all on function %s from %I',p.signature,r);
  end loop;
 end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
