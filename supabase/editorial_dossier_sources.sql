-- Canonical VPS PostgreSQL. Apply AFTER editorial_plan_dispatch.sql.
-- Attach existing server-owned MCP source receipts to a dossier, without a fake
-- published voyage slug or a second corpus store. No sources fetched or tasks run.
begin;
create table if not exists public.editorial_topic_sources (
 id bigint generated always as identity primary key,
 topic_id bigint not null references public.editorial_topics(id),
 consultation_id uuid not null references public.editorial_mcp_consultations(id),
 title text not null check(length(title) between 1 and 500 and title ~ '[^[:space:]]'),
 created_at timestamptz not null default clock_timestamp(),
 unique(topic_id,consultation_id)
);
create table if not exists public.editorial_topic_source_requests (
 request_id text primary key check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
 topic_source_id bigint not null references public.editorial_topic_sources(id),
 created_at timestamptz not null default clock_timestamp()
);
do $$ declare n text; r text; begin
 foreach n in array array['editorial_topic_sources','editorial_topic_source_requests'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.%I from %I',n,r); end if;
  end loop;
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_topic_source_read on public.%I',n);
  execute format('create policy editorial_topic_source_read on public.%I for select to terraveler_service using(true)',n);
  execute format('drop trigger if exists editorial_topic_source_immutable on public.%I',n);
  execute format('create trigger editorial_topic_source_immutable before update or delete or truncate on public.%I for each statement execute function public.editorial_append_only()',n);
 end loop;
end $$;
revoke all on sequence public.editorial_topic_sources_id_seq from public,terraveler_service;

-- Only complete fetch_source_text receipts are research sources. An orientation
-- receipt, a listed URL, a local snapshot or a client's source text is not one.
-- Return references constructed from the stored receipt and CURRENT live policy.
create or replace function public.editorial_receipt_source(p_receipt_id uuid,p_title text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c public.editorial_mcp_consultations; ep public.source_endpoints; policy public.source_policy_decisions;
 host text; fragment text; begin
 select * into c from public.editorial_mcp_consultations where id=p_receipt_id;
 if not found or c.tool<>'fetch_source_text' or c.response->>'url' is distinct from c.arguments->>'url'
  or c.response->>'kind' is distinct from c.arguments->>'kind'
  or c.response->'truncated' is distinct from 'false'::jsonb
  or jsonb_typeof(c.response->'text') is distinct from 'string' or c.response->>'text' !~ '[^[:space:]]'
  or encode(sha256(convert_to(c.response_text,'UTF8')),'hex')<>c.response_sha256
  or p_title is null or length(p_title) not between 1 and 500 or p_title !~ '[^[:space:]]'
  or length(c.response->>'url')>2000
  or c.response->>'url' !~ '^https?://[A-Za-z0-9.-]+(/[^?#[:cntrl:]]*)?$'
 then return null; end if;
 host:=lower(substring(c.response->>'url' from '^https?://([A-Za-z0-9.-]+)'));
 select * into ep from public.source_endpoints e where
  (e.match_type='exact' and e.host_pattern=host and e.host_pattern ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?([.][a-z0-9]+([a-z0-9-]*[a-z0-9])?)+$')
  or (e.match_type='suffix' and e.host_pattern ~ '^[.][a-z0-9]+([a-z0-9-]*[a-z0-9])?([.][a-z0-9]+([a-z0-9-]*[a-z0-9])?)+$' and right(host,length(e.host_pattern))=e.host_pattern)
  order by (e.match_type='exact') desc,length(e.host_pattern) desc,e.id limit 1;
 if not found or ep.status<>'active' or ep.trust_mode is distinct from 'domain_trusted' then return null; end if;
 select * into policy from public.source_policy_decisions where endpoint_id=ep.id order by timestamp desc nulls last,id desc limit 1;
 if not found or policy.decision_outcome<>'approve' or policy.trust_mode is distinct from 'domain_trusted'
  or policy.rights_class not in ('public_domain','creative_commons') then return null; end if;
 fragment:=left(c.response->>'text',2500);
 return jsonb_build_object('id','mcp:'||c.id,'title',p_title,'text',fragment,'url',c.response->>'url','rights',policy.rights_class,
  'governance',jsonb_build_object('endpoint_id',ep.id,'policy_decision_id',policy.id,'rights_class',policy.rights_class,
   'trust_mode',ep.trust_mode,'source_receipt_id',c.id,'source_response_sha256',c.response_sha256,
   'excerpt_start',0,'excerpt_length',length(fragment),'excerpt_shortened',length(c.response->>'text')>2500));
end $$;

create or replace function public.editorial_topic_receipt_sources(p_topic_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare source record; ref jsonb; refs jsonb:='[]'; begin
 for source in select consultation_id,title from public.editorial_topic_sources where topic_id=p_topic_id order by id limit 40 loop
  ref:=public.editorial_receipt_source(source.consultation_id,source.title);
  if ref is not null and octet_length((refs||jsonb_build_array(ref))::text)<=10500 then refs:=refs||jsonb_build_array(ref); end if;
 end loop;
 return refs;
end $$;

create or replace function public.editorial_attach_source(p_topic_id bigint,p_consultation_id uuid,p_title text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_topic_sources; saved public.editorial_topic_sources; begin
 if p_topic_id is null or p_topic_id<=0 or p_consultation_id is null or p_title is null or length(p_title) not between 1 and 500
  or p_title !~ '[^[:space:]]' or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'invalid source attachment'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-source-request:'||p_request_id,0));
 select s.* into prior from public.editorial_topic_source_requests r join public.editorial_topic_sources s on s.id=r.topic_source_id where r.request_id=p_request_id;
 if found then
  if prior.topic_id is distinct from p_topic_id or prior.consultation_id is distinct from p_consultation_id or prior.title is distinct from p_title
   then raise exception 'source attachment idempotency conflict'; end if;
  return jsonb_build_object('id',prior.id,'topic_id',prior.topic_id,'consultation_id',prior.consultation_id,'replayed',true);
 end if;
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 if public.editorial_receipt_source(p_consultation_id,p_title) is null then raise exception 'complete governed MCP source receipt required'; end if;
 select * into saved from public.editorial_topic_sources where topic_id=p_topic_id and consultation_id=p_consultation_id;
 if found then
  if saved.title is distinct from p_title then raise exception 'source attachment title conflict'; end if;
 else
  if (select count(*) from public.editorial_topic_sources where topic_id=p_topic_id)>=40 then raise exception 'dossier source limit reached'; end if;
  insert into public.editorial_topic_sources(topic_id,consultation_id,title) values(p_topic_id,p_consultation_id,p_title) returning * into saved;
 end if;
 insert into public.editorial_topic_source_requests(request_id,topic_source_id) values(p_request_id,saved.id);
 return jsonb_build_object('id',saved.id,'topic_id',saved.topic_id,'consultation_id',saved.consultation_id,'replayed',false);
end $$;

create or replace function public.editorial_read_mcp_corpus(p_task_id bigint,p_attempt integer,p_worker text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare task public.editorial_tasks; stored public.editorial_corpus_consultations;
 scopes text[]; item record; ep public.source_endpoints; policy public.source_policy_decisions;
 host text; ref jsonb; refs jsonb:='[]'::jsonb;
begin
 if p_task_id is null or p_task_id<=0 or p_attempt is null or p_attempt<=0 or p_worker is null or length(p_worker) not between 1 and 120
 then raise exception 'invalid corpus request'; end if;
 select * into task from public.editorial_tasks where id=p_task_id for update;
 if not found or task.role<>'research' or task.state<>'running' or task.attempt<>p_attempt
  or task.worker is distinct from p_worker or task.lease_expires_at<=clock_timestamp()
 then raise exception 'active research task required'; end if;
 if (select count(*) from public.editorial_corpus_consultations where task_id=task.id and attempt=task.attempt)>=3
 then raise exception 'corpus consultation limit reached'; end if;
 select array_agg(distinct snapshot->>'target_voyage') into scopes from public.editorial_topic_submissions
 where topic_id=task.topic_id and snapshot->>'target_voyage' ~ '^[a-z0-9][a-z0-9-]{0,119}$';
 refs:=public.editorial_topic_receipt_sources(task.topic_id);
 if coalesce(cardinality(scopes),0)>20 or (coalesce(cardinality(scopes),0)=0 and jsonb_array_length(refs)=0) then raise exception 'governed dossier sources or voyage corpus scope required'; end if;
 for item in select id,title,left(content,2500) as content,source_url,license from public.rag_docs
  where type='text' and voyage_slug=any(scopes)
  and trim(license) ~* '^(Public domain|CC0( 1[.]0)?|CC BY(-SA)?( [1-4][.]0)?)$'
  order by id limit 40 loop
  if jsonb_array_length(refs)>=40 then exit; end if;
  if item.title is null or trim(item.title)='' or item.content is null or trim(item.content)='' or item.source_url is null
   or length(item.source_url)>2000 or item.source_url !~ '^https?://[A-Za-z0-9.-]+(/[^?#[:cntrl:]]*)?$' then continue; end if;
  host:=lower(substring(item.source_url from '^https?://([A-Za-z0-9.-]+)'));
  -- A more specific retired/denied endpoint cannot fall through to an allowed
  -- suffix. Live policy only; no cached or seed fallback.
  select * into ep from public.source_endpoints e where
   (e.match_type='exact' and e.host_pattern=host and e.host_pattern ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?([.][a-z0-9]+([a-z0-9-]*[a-z0-9])?)+$')
    or (e.match_type='suffix' and e.host_pattern ~ '^[.][a-z0-9]+([a-z0-9-]*[a-z0-9])?([.][a-z0-9]+([a-z0-9-]*[a-z0-9])?)+$' and right(host,length(e.host_pattern))=e.host_pattern)
   order by (e.match_type='exact') desc,length(e.host_pattern) desc,e.id limit 1;
  if not found or ep.status<>'active' or ep.trust_mode is distinct from 'domain_trusted' then continue; end if;
  select * into policy from public.source_policy_decisions where endpoint_id=ep.id order by timestamp desc nulls last,id desc limit 1;
  if not found or policy.decision_outcome<>'approve' or policy.trust_mode is distinct from 'domain_trusted'
   or policy.rights_class not in ('public_domain','creative_commons') then continue; end if;
  ref:=jsonb_build_object('id','rag:'||item.id,'title',left(item.title,500),'text',item.content,'url',item.source_url,'rights',item.license,
   'governance',jsonb_build_object('endpoint_id',ep.id,'policy_decision_id',policy.id,'rights_class',policy.rights_class,'trust_mode',ep.trust_mode));
  if octet_length((refs||jsonb_build_array(ref))::text)>10500 then continue; end if;
  refs:=refs||jsonb_build_array(ref);
 end loop;
 if jsonb_array_length(refs)=0 then raise exception 'no approved corpus sources'; end if;
 if task.lease_expires_at<=clock_timestamp() then raise exception 'active research task required'; end if;
 insert into public.editorial_corpus_consultations(task_id,attempt,snapshot,snapshot_sha256)
 values(task.id,task.attempt,refs,encode(sha256(convert_to(refs::text,'UTF8')),'hex')) returning * into stored;
 return jsonb_build_object('task_id',task.id,'attempt',task.attempt,'sources',stored.snapshot,'consultation',
 jsonb_build_object('id',stored.id,'snapshot_sha256',stored.snapshot_sha256,'created_at',stored.created_at));
end $$;

create or replace function public.editorial_dispatch_plan(p_topic_id bigint,p_plan_id bigint,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_graph_runs; run public.editorial_graph_runs; plan public.editorial_plans; item jsonb; writer_item jsonb; reviewer_item jsonb;
 t public.editorial_tasks; selected_id bigint; selected_key text; selected_keys jsonb:='{}'; v_specialty text; writer_id bigint; n integer; dep text; key text;
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
 for v_specialty in select unnest(array['history','diary','factcheck']) loop
  select count(*),min(a.id),min(a.agent_key) into n,selected_id,selected_key from public.editorial_specialist_agents_current a where a.specialty=v_specialty and a.enabled and a.role=public.editorial_specialty_role(v_specialty);
  if n<>1 then raise exception 'unique enabled specialist required: %',v_specialty; end if;
  selected_keys:=selected_keys||jsonb_build_object(v_specialty,jsonb_build_object('id',selected_id,'key',selected_key));
 end loop;
 for key in select value->>'key' from jsonb_each(selected_keys) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||key,0));
 end loop;
 for v_specialty in select unnest(array['history','diary','factcheck']) loop
  if not exists(select 1 from public.editorial_specialist_agents_current a where a.id=(selected_keys->v_specialty->>'id')::bigint and a.enabled and a.specialty=v_specialty)
  then raise exception 'specialist configuration changed'; end if;
 end loop;
 insert into public.editorial_graph_runs(topic_id,plan_id,request_id) values(p_topic_id,p_plan_id,p_request_id) returning * into run;
 -- Research first, writer second, reviewer last, regardless of input ordering.
 for item in select value from jsonb_array_elements(plan.plan->'work_items') order by case value->>'specialty' when 'history' then 1 when 'diary' then 2 else 3 end,value->>'id' loop
  v_specialty:=item->>'specialty';
  insert into public.editorial_tasks(topic_id,role,task_key,input,dependency_id)
   values(p_topic_id,public.editorial_specialty_role(v_specialty),'graph:'||run.id||':'||(item->>'id'),
    jsonb_build_object('graph_run_id',run.id,'plan_id',p_plan_id,'work_item_id',item->>'id','work_item',item),
    case when v_specialty='factcheck' then writer_id else null end) returning * into t;
  if v_specialty='diary' then writer_id:=t.id; end if;
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


-- Helpers remain owner-internal. The existing worker-only MCP server RPC keeps
-- its grants; only the editor's trusted data service may attach receipt IDs.
do $$ declare f record; r text; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('editorial_receipt_source','editorial_topic_receipt_sources','editorial_attach_source','editorial_read_mcp_corpus','editorial_dispatch_plan') loop
  execute format('revoke all on function %s from public,terraveler_service',f.signature);
  foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function %s from %I',f.signature,r); end if;
  end loop;
  if f.proname in ('editorial_attach_source','editorial_read_mcp_corpus','editorial_dispatch_plan') then
   execute format('grant execute on function %s to terraveler_service',f.signature);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
