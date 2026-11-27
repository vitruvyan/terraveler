-- Canonical VPS. Apply after editorial_waypoints.sql and editorial_commons_images.sql.
-- Executable Photo editor (iconography). Its result is a bounded selection of
-- Commons images, each the exact snapshot of a fetch_commons_image receipt
-- recorded during the task's own attempt, with a constrained model judgment.
-- Image selections are not textual evidence: writers do not depend on them and
-- never receive them as research. Caption remains closed.
-- Each redefined function is taken from the production definition (md5 checked)
-- and changed only where marked.
begin;

create or replace function public.editorial_graph_check_image(v jsonb,p_task_id bigint,p_attempt integer)
returns boolean language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 -- A selected image is the exact snapshot of a fetch_commons_image receipt recorded
 -- during this attempt, plus a bounded model judgment. Nothing else is accepted.
 select jsonb_typeof(v)='object'
 and (select array_agg(k order by k) from jsonb_object_keys(v) k)=array['caution','depiction','receipt_id','receipt_sha256','relevance','snapshot']
 and v->>'depiction' in ('period-artwork','period-map','period-document','later-artwork','later-map','modern-photograph','modern-reproduction','unknown')
 and jsonb_typeof(v->'relevance')='string' and length(v->>'relevance') between 1 and 1000 and (v->>'relevance') !~ '["“”«»]'
 and (v->'caution'='null'::jsonb or (jsonb_typeof(v->'caution')='string' and length(v->>'caution') between 1 and 1000 and (v->>'caution') !~ '["“”«»]'))
 and exists(select 1 from public.editorial_mcp_consultations c
  where c.id::text=v->>'receipt_id' and c.tool='fetch_commons_image'
  and c.response_sha256=v->>'receipt_sha256' and c.response=v->'snapshot'
  and c.created_at>=(select max(e.created_at) from public.editorial_task_events e
   where e.task_id=p_task_id and e.attempt=p_attempt and e.event='claimed'))
$$;
revoke all on function public.editorial_graph_check_image(jsonb,bigint,integer) from public,terraveler_service,terraveler_editorial_worker;

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
  if p_enabled and effective_specialty not in ('managing-editor','history','ethnohistory','itinerary','iconography','diary','editorial','copyedit','factcheck') then return jsonb_build_object('error','specialist-handler-not-implemented'); end if;
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
 if p_specialty not in ('history','ethnohistory','itinerary','iconography','diary','editorial','copyedit','factcheck') then raise exception 'specialist handler not implemented'; end if;
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
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty' not in ('history','ethnohistory','itinerary','iconography','diary','editorial','copyedit','factcheck'))
 then raise exception 'specialist handler not implemented'; end if;
 -- Textual research feeds the writers; at most one iconography item stands apart
 -- (no writer or research item may depend on it until the caption specialist exists).
 select count(*) into n from jsonb_array_elements(plan.plan->'work_items') v where public.editorial_specialty_role(v->>'specialty')='research' and v->>'specialty'<>'iconography';
 if n not between 1 and 4 then raise exception 'one to four research items required'; end if;
 if (select count(*) from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='iconography')>1
 then raise exception 'at most one iconography item allowed'; end if;
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') v where v->>'specialty'='iconography' and jsonb_array_length(v->'depends_on')<>0)
 or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') x cross join lateral jsonb_array_elements_text(x->'depends_on') d
  join jsonb_array_elements(plan.plan->'work_items') i on i->>'id'=d.value where i->>'specialty'='iconography')
 then raise exception 'unsupported editorial dependency graph'; end if;
 -- Every writer covers all research. Research may depend only on earlier research.
 if exists(select 1 from jsonb_array_elements(plan.plan->'work_items') w
  where public.editorial_specialty_role(w->>'specialty')='writer'
  and (jsonb_array_length(w->'depends_on')<>n or exists(select 1 from jsonb_array_elements(plan.plan->'work_items') r
   where public.editorial_specialty_role(r->>'specialty')='research' and r->>'specialty'<>'iconography' and not (w->'depends_on' ? (r->>'id')))))
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

create or replace function public.editorial_graph_context(p_task_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare g public.editorial_graph_tasks; t public.editorial_tasks; result jsonb;
 refs jsonb:='[]'; findings jsonb:='[]'; uncertainties jsonb:='[]'; waypoints jsonb:='[]';
 v jsonb; prior jsonb; research jsonb; draft jsonb; dep_results jsonb;
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
  -- Image selections are not textual evidence: writers never receive them as research.
  if result->>'kind'='iconography' then continue; end if;
  if result->>'kind' is distinct from 'research' then raise exception 'research result required'; end if;
  for v in select value from jsonb_array_elements(result->'references') loop
   if not public.editorial_graph_check_reference(v,g.run_id) then raise exception 'source policy changed or receipt invalid'; end if;
   select value into prior from jsonb_array_elements(refs) where value->>'id'=v->>'id';
   if not found then refs:=refs||jsonb_build_array(v);
   elsif (prior-'governance') is distinct from (v-'governance') then raise exception 'conflicting source snapshots'; end if;
  end loop;
  findings:=findings||coalesce(result->'findings','[]');
  uncertainties:=uncertainties||coalesce(result->'uncertainties','[]');
  waypoints:=waypoints||coalesce(result->'waypoints','[]');
 end loop;
 if jsonb_array_length(refs) not between 1 and 40 or jsonb_array_length(findings) not between 1 and 100
 or jsonb_array_length(waypoints)>40 or octet_length((refs||findings||waypoints)::text)>40000
 then raise exception 'research synthesis exceeds bounded context'; end if;
 research:=jsonb_build_object('kind','research','references',refs,'findings',findings,'uncertainties',uncertainties,'waypoints',waypoints);
 if t.role='reviewer' then
  select r.result into draft from public.editorial_results r where r.task_id=t.dependency_id;
  if draft->>'kind' is distinct from 'draft' then raise exception 'draft result required'; end if;
  if draft->'waypoints' is distinct from waypoints then raise exception 'waypoint provenance mismatch'; end if;
  return jsonb_build_object('research_result',research,'draft_result',draft);
 end if;
 return jsonb_build_object('research_result',research);
end $$;

create or replace function public.editorial_graph_result_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; g public.editorial_graph_tasks; v jsonb; ctx jsonb; refs jsonb; v_specialty text; images jsonb;
begin
 select * into t from public.editorial_tasks where id=new.task_id;
 select * into g from public.editorial_graph_tasks where task_id=new.task_id;
 if not found then
  if (select mandatory from public.editorial_graph_policy where singleton) then raise exception 'reviewed editorial plan required'; end if;
  return new;
 end if;
 if not public.editorial_graph_authorized(t.id) then raise exception 'plan task not authorized'; end if;
 select item->>'specialty' into v_specialty from public.editorial_graph_runs run join public.editorial_plans p on p.id=run.plan_id
  cross join lateral jsonb_array_elements(p.plan->'work_items') item where run.id=g.run_id and item->>'id'=g.work_item_id;
 if new.result->>'kind' is distinct from (case when v_specialty='iconography' then 'iconography' when t.role='research' then 'research' when t.role='writer' then 'draft' else 'review' end) then raise exception 'wrong plan result kind'; end if;
 if v_specialty='iconography' then
  images:=new.result->'images';
  if jsonb_typeof(images) is distinct from 'array' or jsonb_array_length(images)>12 then raise exception 'image selections required'; end if;
  if jsonb_typeof(new.result->'uncertainties') is distinct from 'array'
  or (jsonb_array_length(images)=0 and jsonb_array_length(new.result->'uncertainties')=0)
  then raise exception 'an empty image selection must state why'; end if;
  for v in select value from jsonb_array_elements(images) loop
   if not public.editorial_graph_check_image(v,t.id,t.attempt) then raise exception 'invalid Commons image receipt'; end if;
  end loop;
  if (select count(distinct value->>'receipt_id') from jsonb_array_elements(images))<>jsonb_array_length(images) then raise exception 'duplicate image selection'; end if;
 elsif t.role='research' then
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

revoke all on function public.editorial_graph_context(bigint) from public,terraveler_service,terraveler_editorial_worker;
notify pgrst,'reload schema';
commit;
