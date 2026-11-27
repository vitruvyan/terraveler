-- Canonical VPS. Apply after editorial_dossier_sources.sql.
-- Enables the evidence-bound textual specialties; image specialties remain closed.
begin;

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
  if p_enabled and effective_specialty not in ('managing-editor','history','ethnohistory','itinerary','diary','editorial','copyedit','factcheck') then return jsonb_build_object('error','specialist-handler-not-implemented'); end if;
 end if;
 receipt:=public.desk_save_editorial_agent(p_agent_key,p_name,p_role,p_model,p_instructions,p_enabled,p_expected_version,p_request_id);
 if receipt ? 'error' then return receipt; end if;
 if effective_specialty is not null then
  select id into version_id from public.editorial_agent_versions where request_id=p_request_id;
  insert into public.editorial_agent_specialties(agent_version_id,specialty,requested_specialty) values(version_id,effective_specialty,p_specialty);
 end if;
 return receipt||jsonb_build_object('specialty',effective_specialty);
end $$;

create or replace function public.editorial_assign_specialist(p_task_id bigint,p_agent_key text,p_specialty text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare existing public.editorial_specialist_assignments; t public.editorial_tasks;
 current_agent public.editorial_agent_versions; expected_role text; begin
 if p_agent_key is null or p_agent_key !~ '^[a-z0-9][a-z0-9-]{1,79}$'
   or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'invalid specialist assignment'; end if;
 expected_role:=public.editorial_specialty_role(p_specialty);
 if expected_role is null then raise exception 'unknown specialty'; end if;
 if p_specialty not in ('history','ethnohistory','itinerary','diary','editorial','copyedit','factcheck') then raise exception 'specialist handler not implemented'; end if;
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

create or replace function public.editorial_dispatch_plan(p_topic_id bigint,p_plan_id bigint,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_graph_runs; run public.editorial_graph_runs; plan public.editorial_plans; item jsonb;
 t public.editorial_tasks; selected_id bigint; selected_key text; selected_keys jsonb:='{}'; v_specialty text; n integer; dep text; key text;
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
  and jsonb_array_length(public.editorial_topic_receipt_sources(p_topic_id))=0
 then raise exception 'approved voyage corpus scope or governed dossier sources required'; end if;
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty' not in ('history','ethnohistory','itinerary','diary','editorial','copyedit','factcheck'))
 then raise exception 'specialist handler not implemented'; end if;
 select count(*) into n from jsonb_array_elements(plan.plan->'work_items') v where public.editorial_specialty_role(v->>'specialty')='research';
 if n not between 1 and 4 then raise exception 'one to four research items required'; end if;
 -- Every writer covers all research. Research may depend only on earlier research.
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') w
  where public.editorial_specialty_role(w->>'specialty')='writer'
  and (jsonb_array_length(w->'depends_on')<>n or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') r
   where public.editorial_specialty_role(r->>'specialty')='research' and not (w->'depends_on' ? (r->>'id')))))
 then raise exception 'unsupported editorial dependency graph'; end if;
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') r cross join lateral jsonb_array_elements_text(r->'depends_on') d
  where public.editorial_specialty_role(r->>'specialty')='research' and not exists(select 1 from jsonb_array_elements(plan.plan->'work_items') p
   where p->>'id'=d.value and public.editorial_specialty_role(p->>'specialty')='research'))
 then raise exception 'unsupported editorial dependency graph'; end if;
 -- A review targets exactly one draft; every draft has exactly one factcheck.
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') r
  where public.editorial_specialty_role(r->>'specialty')='reviewer'
  and (jsonb_array_length(r->'depends_on')<>1 or not exists(select 1 from jsonb_array_elements(plan.plan->'work_items') w
   where w->>'id'=r->'depends_on'->>0 and public.editorial_specialty_role(w->>'specialty')='writer')))
 then raise exception 'unsupported editorial dependency graph'; end if;
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') w
  where public.editorial_specialty_role(w->>'specialty')='writer'
  and (select count(*) from jsonb_array_elements(plan.plan->'work_items') r
   where r->>'specialty'='factcheck' and r->'depends_on'=jsonb_build_array(w->>'id'))<>1)
 then raise exception 'one factcheck per writer required'; end if;
 -- Backward-compatible pilot: one diary and its factcheck. Full textual graph:
 -- diary + editorial, each with an independent copyedit and factcheck.
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty' in ('editorial','copyedit')) then
  if (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='diary')<>1
  or (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='editorial')<>1
  or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') w where public.editorial_specialty_role(w->>'specialty')='writer'
   and (select count(*) from jsonb_array_elements(plan.plan->'work_items') r
    where r->>'specialty'='copyedit' and r->'depends_on'=jsonb_build_array(w->>'id'))<>1)
  then raise exception 'unsupported editorial dependency graph'; end if;
 elsif (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='diary')<>1
  or (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where public.editorial_specialty_role(v->>'specialty')='writer')<>1
 then raise exception 'unsupported editorial dependency graph'; end if;
 for v_specialty in select distinct value->>'specialty' from jsonb_array_elements(plan.plan->'work_items') loop
  select count(*),min(a.id),min(a.agent_key) into n,selected_id,selected_key from public.editorial_specialist_agents_current a where a.specialty=v_specialty and a.enabled and a.role=public.editorial_specialty_role(v_specialty);
  if n<>1 then raise exception 'unique enabled specialist required: %',v_specialty; end if;
  selected_keys:=selected_keys||jsonb_build_object(v_specialty,jsonb_build_object('id',selected_id,'key',selected_key));
 end loop;
 for key in select value->>'key' from jsonb_each(selected_keys) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||key,0));
 end loop;
 for v_specialty in select distinct value->>'specialty' from jsonb_array_elements(plan.plan->'work_items') loop
  if not exists(select 1 from public.editorial_specialist_agents_current a where a.id=(selected_keys->v_specialty->>'id')::bigint and a.enabled and a.specialty=v_specialty)
  then raise exception 'specialist configuration changed'; end if;
 end loop;
 insert into public.editorial_graph_runs(topic_id,plan_id,request_id) values(p_topic_id,p_plan_id,p_request_id) returning * into run;
 for item in select value from jsonb_array_elements(plan.plan->'work_items') order by case public.editorial_specialty_role(value->>'specialty') when 'research' then 1 when 'writer' then 2 else 3 end,value->>'id' loop
  v_specialty:=item->>'specialty';
  insert into public.editorial_tasks(topic_id,role,task_key,input,dependency_id)
   values(p_topic_id,public.editorial_specialty_role(v_specialty),'graph:'||run.id||':'||(item->>'id'),
    jsonb_build_object('graph_run_id',run.id,'plan_id',p_plan_id,'work_item_id',item->>'id','work_item',item),
    case when public.editorial_specialty_role(v_specialty)='reviewer' then
     (select g.task_id from public.editorial_graph_tasks g where g.run_id=run.id and g.work_item_id=item->'depends_on'->>0)
    else null end) returning * into t;
  insert into public.editorial_graph_tasks(task_id,run_id,work_item_id) values(t.id,run.id,item->>'id');
  insert into public.editorial_task_agents(task_id,agent_version_id) values(t.id,(selected_keys->v_specialty->>'id')::bigint);
  insert into public.editorial_specialist_assignments(task_id,agent_key,specialty,request_id)
   values(t.id,selected_keys->v_specialty->>'key',v_specialty,'graph-assignment-'||t.id);
  insert into public.editorial_task_events(task_id,event,attempt,detail) values(t.id,'queued',0,jsonb_build_object('plan_id',p_plan_id,'work_item_id',item->>'id','agent_version_id',(selected_keys->v_specialty->>'id')::bigint));
 end loop;
 for item in select value from jsonb_array_elements(plan.plan->'work_items') loop
  for dep in select value from jsonb_array_elements_text(item->'depends_on') loop
   insert into public.editorial_graph_edges(task_id,depends_on)
   select x.task_id,y.task_id from public.editorial_graph_tasks x join public.editorial_graph_tasks y on y.run_id=x.run_id where x.run_id=run.id and x.work_item_id=item->>'id' and y.work_item_id=dep;
  end loop;
 end loop;
 return jsonb_build_object('run_id',run.id,'plan_id',p_plan_id,'replayed',false);
end $$;

create or replace view public.editorial_graph_status with(security_invoker=true) as
 select g.id,g.topic_id,g.plan_id,g.request_id,g.created_at,
 case when bool_or(t.state='attention') then 'attention'
  when bool_and(t.state='completed') then
   case when bool_and(t.role<>'reviewer' or r.result->>'verdict'='ready-for-editor') then 'awaiting-editor' else 'attention' end
  when bool_or(t.state='running') then 'running' else 'queued' end as state,
 count(*)::integer as task_count,count(*) filter(where t.state='completed')::integer as completed_count
 from public.editorial_graph_runs g join public.editorial_graph_tasks m on m.run_id=g.id
 join public.editorial_tasks t on t.id=m.task_id left join public.editorial_results r on r.task_id=t.id group by g.id;

notify pgrst,'reload schema';
commit;
