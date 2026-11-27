-- Canonical VPS. Apply after editorial_task_retry.sql.
-- Automatically schedule at most two writer revisions from completed plan reviews.
begin;

alter table public.editorial_graph_tasks add column if not exists revision integer not null default 0 check(revision between 0 and 2);
alter table public.editorial_graph_tasks drop constraint if exists editorial_graph_tasks_run_id_work_item_id_key;
alter table public.editorial_graph_tasks drop constraint if exists editorial_graph_tasks_run_item_revision_key;
alter table public.editorial_graph_tasks add constraint editorial_graph_tasks_run_item_revision_key unique(run_id,work_item_id,revision);

create or replace function public.editorial_graph_review_composition(p_run_id bigint,p_writer_item text,p_revision integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare run public.editorial_graph_runs; expected integer; present integer; issues jsonb; sources jsonb;
 all_ready boolean; any_blocked boolean; v_verdict text;
begin
 select * into run from public.editorial_graph_runs where id=p_run_id;
 select count(*) into expected from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items') item
  where p.id=run.plan_id and public.editorial_specialty_role(item->>'specialty')='reviewer' and item->'depends_on'=jsonb_build_array(p_writer_item);
 if expected=0 then return null; end if;
 select count(*),bool_and(r.result->>'verdict'='ready-for-editor'),bool_or(r.result->>'verdict'='blocked'),
  jsonb_agg(jsonb_build_object('task_id',t.id,'result_id',r.id,'work_item_id',m.work_item_id,'verdict',r.result->>'verdict') order by m.work_item_id)
  into present,all_ready,any_blocked,sources
  from public.editorial_graph_tasks m join public.editorial_tasks t on t.id=m.task_id join public.editorial_results r on r.task_id=t.id
  join public.editorial_plans p on p.id=run.plan_id cross join lateral jsonb_array_elements(p.plan->'work_items') item
  where m.run_id=p_run_id and m.revision=p_revision and t.state='completed' and item->>'id'=m.work_item_id
   and public.editorial_specialty_role(item->>'specialty')='reviewer' and item->'depends_on'=jsonb_build_array(p_writer_item);
 if present<>expected then return null; end if;
 select coalesce(jsonb_agg(issue.value order by m.work_item_id,issue.ordinality),'[]') into issues
  from public.editorial_graph_tasks m join public.editorial_tasks t on t.id=m.task_id join public.editorial_results r on r.task_id=t.id
  join public.editorial_plans p on p.id=run.plan_id cross join lateral jsonb_array_elements(p.plan->'work_items') item
  cross join lateral jsonb_array_elements(r.result->'issues') with ordinality issue(value,ordinality)
  where m.run_id=p_run_id and m.revision=p_revision and t.state='completed' and item->>'id'=m.work_item_id
   and public.editorial_specialty_role(item->>'specialty')='reviewer' and item->'depends_on'=jsonb_build_array(p_writer_item);
 v_verdict:=case when all_ready then 'ready-for-editor' when any_blocked then 'blocked' else 'changes-requested' end;
 return jsonb_build_object('kind','review','verdict',v_verdict,'issues',issues,'source_reviews',sources);
end $$;

create or replace function public.editorial_graph_revision_input(p_run_id bigint,p_writer_item text,p_revision integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare draft jsonb; review jsonb;
begin
 if p_revision not between 1 and 2 then return null; end if;
 select r.result into draft from public.editorial_graph_tasks m join public.editorial_results r on r.task_id=m.task_id
  where m.run_id=p_run_id and m.work_item_id=p_writer_item and m.revision=p_revision-1;
 review:=public.editorial_graph_review_composition(p_run_id,p_writer_item,p_revision-1);
 if draft->>'kind' is distinct from 'draft' or review->>'verdict' is distinct from 'changes-requested' then return null; end if;
 return jsonb_build_object('draft_result',draft,'review_result',review);
end $$;

create or replace function public.editorial_graph_enqueue_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare run public.editorial_graph_runs; item jsonb; base jsonb; revision_text text; requested_revision integer; writer_item text; expected_key text;
begin
 if not (new.input ? 'graph_run_id') then
  if (select mandatory from public.editorial_graph_policy where singleton) then raise exception 'reviewed editorial plan required'; end if;
  return new;
 end if;
 if coalesce(new.input->>'graph_run_id','') !~ '^[1-9][0-9]{0,17}$' then raise exception 'invalid plan task'; end if;
 select * into run from public.editorial_graph_runs where id=(new.input->>'graph_run_id')::bigint and topic_id=new.topic_id;
 if not found then raise exception 'invalid plan task'; end if;
 select value into item from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items') where p.id=run.plan_id and value->>'id'=new.input->>'work_item_id';
 revision_text:=coalesce(new.input->>'revision','0');
 if revision_text !~ '^[0-2]$' then raise exception 'invalid plan revision'; end if;
 requested_revision:=revision_text::integer;
 if requested_revision=0 then
  expected_key:='graph:'||run.id||':'||(item->>'id');
 else
  expected_key:='graph:'||run.id||':'||(item->>'id')||':revision:'||requested_revision;
 end if;
 base:=jsonb_build_object('graph_run_id',run.id,'plan_id',run.plan_id,'work_item_id',item->>'id','work_item',item);
 if requested_revision>0 then base:=base||jsonb_build_object('revision',requested_revision); end if;
 if item is null or new.role is distinct from public.editorial_specialty_role(item->>'specialty')
 or new.task_key<>expected_key then raise exception 'invalid plan task'; end if;
 if requested_revision>0 then
  if new.role='writer' then
   if new.dependency_id is not null then raise exception 'invalid plan revision'; end if;
   base:=base||coalesce(public.editorial_graph_revision_input(run.id,item->>'id',requested_revision),'{}'::jsonb);
   if not (base ? 'review_result') then raise exception 'invalid plan revision'; end if;
  elsif new.role='reviewer' then
   writer_item:=item->'depends_on'->>0;
   if new.dependency_id is null or not exists(select 1 from public.editorial_graph_tasks m join public.editorial_tasks t on t.id=m.task_id
    where m.run_id=run.id and m.work_item_id=writer_item and m.revision=requested_revision and t.id=new.dependency_id and t.state='completed')
   then raise exception 'invalid plan revision'; end if;
  else raise exception 'invalid plan revision'; end if;
 end if;
 if new.input is distinct from base then raise exception 'invalid plan task'; end if;
 return new;
end $$;

create or replace function public.editorial_graph_add_revision(p_run_id bigint,p_work_item text,p_revision integer,p_dependency_id bigint,p_context jsonb)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare run public.editorial_graph_runs; item jsonb; t public.editorial_tasks; prior public.editorial_graph_tasks;
 agent_version bigint; agent_key text; existing bigint; dep text;
begin
 if p_revision not between 1 and 2 or p_context is null or jsonb_typeof(p_context)<>'object' then raise exception 'invalid plan revision'; end if;
 select * into run from public.editorial_graph_runs where id=p_run_id for update;
 if not found then raise exception 'invalid plan revision'; end if;
 select task_id into existing from public.editorial_graph_tasks where run_id=p_run_id and work_item_id=p_work_item and revision=p_revision;
 if found then return existing; end if;
 select value into item from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items') where p.id=run.plan_id and value->>'id'=p_work_item;
 if item is null or public.editorial_specialty_role(item->>'specialty') not in ('writer','reviewer') then raise exception 'invalid plan revision'; end if;
 select * into prior from public.editorial_graph_tasks where run_id=p_run_id and work_item_id=p_work_item and revision=0;
 select b.agent_version_id,a.agent_key into agent_version,agent_key from public.editorial_task_agents b
  join public.editorial_specialist_assignments a on a.task_id=b.task_id where b.task_id=prior.task_id;
 if agent_version is null or agent_key is null then raise exception 'invalid plan revision'; end if;
 insert into public.editorial_tasks(topic_id,role,task_key,input,dependency_id)
  values(run.topic_id,public.editorial_specialty_role(item->>'specialty'),
   'graph:'||run.id||':'||p_work_item||':revision:'||p_revision,
   jsonb_build_object('graph_run_id',run.id,'plan_id',run.plan_id,'work_item_id',p_work_item,'work_item',item,'revision',p_revision)||p_context,
   p_dependency_id) returning * into t;
 insert into public.editorial_graph_tasks(task_id,run_id,work_item_id,revision) values(t.id,run.id,p_work_item,p_revision);
 insert into public.editorial_task_agents(task_id,agent_version_id) values(t.id,agent_version);
 insert into public.editorial_specialist_assignments(task_id,agent_key,specialty,request_id)
  select t.id,agent_key,item->>'specialty','graph-assignment-'||t.id;
 insert into public.editorial_task_events(task_id,event,attempt,detail)
  values(t.id,'queued',0,jsonb_build_object('plan_id',run.plan_id,'work_item_id',p_work_item,'agent_version_id',agent_version,'revision',p_revision));
 if public.editorial_specialty_role(item->>'specialty')='writer' then
  for dep in select value from jsonb_array_elements_text(item->'depends_on') loop
   insert into public.editorial_graph_edges(task_id,depends_on)
    select t.id,m.task_id from public.editorial_graph_tasks m where m.run_id=run.id and m.work_item_id=dep and m.revision=0;
  end loop;
 else
  insert into public.editorial_graph_edges(task_id,depends_on) values(t.id,p_dependency_id);
 end if;
 return t.id;
end $$;

create or replace function public.editorial_graph_revision_advance()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare g public.editorial_graph_tasks; run public.editorial_graph_runs; item jsonb; writer_item text;
 review jsonb; context jsonb;
begin
 select * into g from public.editorial_graph_tasks where task_id=new.id;
 if not found then return new; end if;
 if exists(select 1 from public.editorial_graph_tasks x where x.run_id=g.run_id and x.work_item_id=g.work_item_id and x.revision>g.revision) then return new; end if;
 select * into run from public.editorial_graph_runs where id=g.run_id for update;
 if new.role='writer' and g.revision>0 then
  for item in select value from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items')
   where p.id=run.plan_id and public.editorial_specialty_role(value->>'specialty')='reviewer' and value->'depends_on'=jsonb_build_array(g.work_item_id) loop
   perform public.editorial_graph_add_revision(run.id,item->>'id',g.revision,new.id,'{}'::jsonb);
  end loop;
 elsif new.role='reviewer' then
  select wi.value->'depends_on'->>0 into writer_item from public.editorial_plans p cross join lateral jsonb_array_elements(p.plan->'work_items') wi(value)
   where p.id=run.plan_id and wi.value->>'id'=g.work_item_id;
  review:=public.editorial_graph_review_composition(run.id,writer_item,g.revision);
  if review->>'verdict'='changes-requested' and g.revision<2 then
   context:=public.editorial_graph_revision_input(run.id,writer_item,g.revision+1);
   perform public.editorial_graph_add_revision(run.id,writer_item,g.revision+1,null,context);
  end if;
 end if;
 return new;
end $$;

drop trigger if exists editorial_graph_revision_schedule on public.editorial_tasks;
create trigger editorial_graph_revision_schedule after update of state on public.editorial_tasks
 for each row when(new.state='completed' and old.state is distinct from new.state) execute function public.editorial_graph_revision_advance();

create or replace view public.editorial_graph_status with(security_invoker=true) as
 with latest as(
  select g.id,g.topic_id,g.plan_id,g.request_id,g.created_at,m.revision,t.role,t.state,r.result,
   row_number() over(partition by g.id,m.work_item_id order by m.revision desc) position
  from public.editorial_graph_runs g join public.editorial_graph_tasks m on m.run_id=g.id
  join public.editorial_tasks t on t.id=m.task_id left join public.editorial_results r on r.task_id=t.id
 ) select id,topic_id,plan_id,request_id,created_at,
  case when bool_or(state='attention') then 'attention'
   when bool_and(state='completed') then
    case when bool_and(role<>'reviewer' or result->>'verdict'='ready-for-editor') then 'awaiting-editor' else 'attention' end
   when bool_or(state='running') then 'running' else 'queued' end as state,
  count(*)::integer as task_count,count(*) filter(where state='completed')::integer as completed_count,
  max(revision)::integer as revision
  from latest where position=1 group by id,topic_id,plan_id,request_id,created_at;

revoke all on public.editorial_graph_status from public,terraveler_service;
grant select on public.editorial_graph_status to terraveler_service;
do $$ declare f record; r text; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('editorial_graph_review_composition','editorial_graph_revision_input','editorial_graph_enqueue_guard','editorial_graph_add_revision','editorial_graph_revision_advance') loop
  execute format('revoke all on function %s from public,terraveler_service',f.signature);
  foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %s',f.signature,r); end if;
  end loop;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
