-- Canonical VPS PostgreSQL. Apply AFTER editorial_dossier_sources.sql.
--
-- Research sources chosen for the question, not by insertion order.
--
-- Until now a research task received the first rag_docs of its voyage by id,
-- cut at ~10.5 KB: every work item of a dossier (history, ethnohistory,
-- itinerary) was handed the same opening pages of one book, although the corpus
-- held several works. The corpus read now
--   * ranks the voyage's governed chunks by distance to the work item's own
--     question, when the worker supplies that question's embedding;
--   * otherwise spreads the read across works (first chunk of every work, then
--     the second...), never the first pages of one book;
--   * keeps at most three chunks of any one work and ten of any one host, so
--     the read is a mix: modern encyclopaedia prose sits closer to a modern
--     question than a sixteenth-century translation does, and without the host
--     cap an eyewitness account lost every slot to Wikipedia;
--   * gives editor-attached dossier receipts a share of the budget rather than
--     all of it, unless the dossier has no voyage corpus at all;
--   * records why: mode, the question, the cap and every pick with its work and
--     distance, beside the snapshot in editorial_corpus_consultations.
-- Governance is unchanged: the same live endpoint and policy checks decide what
-- may be read; ranking only decides the order among what is already allowed.
begin;
alter table public.editorial_corpus_consultations add column if not exists retrieval jsonb
 check (retrieval is null or (jsonb_typeof(retrieval)='object' and octet_length(retrieval::text)<=16000));

drop function if exists public.editorial_read_mcp_corpus(bigint,integer,text);
create or replace function public.editorial_read_mcp_corpus(p_task_id bigint,p_attempt integer,p_worker text,p_query_embedding text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare task public.editorial_tasks; stored public.editorial_corpus_consultations;
 scopes text[]; item record; ep public.source_endpoints; policy public.source_policy_decisions;
 host text; ref jsonb; refs jsonb:='[]'::jsonb; picks jsonb:='[]'::jsonb; per_work jsonb:='{}'::jsonb; per_host jsonb:='{}'::jsonb;
 mode text; question text; dims integer; receipt_budget integer; candidates text;
 budget constant integer:=18000; work_cap constant integer:=3; host_cap constant integer:=10; max_refs constant integer:=24;
begin
 if p_task_id is null or p_task_id<=0 or p_attempt is null or p_attempt<=0 or p_worker is null or length(p_worker) not between 1 and 120
 then raise exception 'invalid corpus request'; end if;
 select * into task from public.editorial_tasks where id=p_task_id for update;
 if not found or task.role<>'research' or task.state<>'running' or task.attempt<>p_attempt
  or task.worker is distinct from p_worker or task.lease_expires_at<=clock_timestamp()
 then raise exception 'active research task required'; end if;
 if (select count(*) from public.editorial_corpus_consultations where task_id=task.id and attempt=task.attempt)>=3
 then raise exception 'corpus consultation limit reached'; end if;
 question:=left(task.input->'work_item'->>'question',2000);
 if p_query_embedding is null then mode:='diversity';
 else
  -- The vector type is touched only through dynamic SQL, in this branch.
  if length(p_query_embedding)>40000 or p_query_embedding !~ '^\[[-+0-9.eE, ]+\]$' or question is null or question !~ '[^[:space:]]'
  then raise exception 'invalid query embedding'; end if;
  begin execute 'select vector_dims($1::vector)' into dims using p_query_embedding;
  exception when others then raise exception 'invalid query embedding'; end;
  if dims<>768 then raise exception 'invalid query embedding'; end if;
  mode:='relevance';
 end if;
 select array_agg(distinct snapshot->>'target_voyage') into scopes from public.editorial_topic_submissions
 where topic_id=task.topic_id and snapshot->>'target_voyage' ~ '^[a-z0-9][a-z0-9-]{0,119}$';
 if coalesce(cardinality(scopes),0)>20 then raise exception 'governed dossier sources or voyage corpus scope required'; end if;
 -- Editor-attached receipts first, within their share.
 receipt_budget:=case when coalesce(cardinality(scopes),0)=0 then budget else 7000 end;
 for ref in select value from jsonb_array_elements(public.editorial_topic_receipt_sources(task.topic_id)) loop
  if octet_length((refs||jsonb_build_array(ref))::text)>receipt_budget then continue; end if;
  refs:=refs||jsonb_build_array(ref);
  picks:=picks||jsonb_build_array(jsonb_build_object('id',ref->>'id','work','receipt:'||(ref->>'url')));
 end loop;
 if coalesce(cardinality(scopes),0)=0 and jsonb_array_length(refs)=0 then raise exception 'governed dossier sources or voyage corpus scope required'; end if;
 if coalesce(cardinality(scopes),0)>0 then
  candidates:=format($q$
   select id,title,content,source_url,license,work,distance from (
    select d.id,d.title,left(d.content,2500) as content,d.source_url,d.license,
     coalesce(nullif(d.work_id,''),'url:'||d.source_url) as work,
     %s as distance,
     row_number() over (partition by coalesce(nullif(d.work_id,''),'url:'||d.source_url) order by d.chunk_index nulls last,d.id) as nth
    from public.rag_docs d
    where d.type='text' and d.voyage_slug=any($1) %s
     and trim(d.license) ~* '^(Public domain|CC0( 1[.]0)?|CC BY(-SA)?( [1-4][.]0)?)$') ranked
   order by %s limit 600$q$,
   case when mode='relevance' then '(d.embedding <=> $2::vector)' else 'null::double precision' end,
   case when mode='relevance' then 'and d.embedding is not null' else '' end,
   case when mode='relevance' then 'distance,id' else 'nth,work,id' end);
  for item in execute candidates using scopes,p_query_embedding loop
   exit when jsonb_array_length(refs)>=max_refs or octet_length(refs::text)>budget-500;
   if coalesce((per_work->>item.work)::integer,0)>=work_cap then continue; end if;
   if item.title is null or trim(item.title)='' or item.content is null or trim(item.content)='' or item.source_url is null
    or length(item.source_url)>2000 or item.source_url !~ '^https?://[A-Za-z0-9.-]+(/[^?#[:cntrl:]]*)?$' then continue; end if;
   host:=lower(substring(item.source_url from '^https?://([A-Za-z0-9.-]+)'));
   if coalesce((per_host->>host)::integer,0)>=host_cap then continue; end if;
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
   if octet_length((refs||jsonb_build_array(ref))::text)>budget then continue; end if;
   refs:=refs||jsonb_build_array(ref);
   per_work:=per_work||jsonb_build_object(item.work,coalesce((per_work->>item.work)::integer,0)+1);
   per_host:=per_host||jsonb_build_object(host,coalesce((per_host->>host)::integer,0)+1);
   picks:=picks||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id','rag:'||item.id,'work',left(item.work,300),
    'distance',round(item.distance::numeric,4))));
  end loop;
 end if;
 if jsonb_array_length(refs)=0 then raise exception 'no approved corpus sources'; end if;
 if task.lease_expires_at<=clock_timestamp() then raise exception 'active research task required'; end if;
 insert into public.editorial_corpus_consultations(task_id,attempt,snapshot,snapshot_sha256,retrieval)
 values(task.id,task.attempt,refs,encode(sha256(convert_to(refs::text,'UTF8')),'hex'),
  jsonb_build_object('mode',mode,'question',question,'per_work_cap',work_cap,'per_host_cap',host_cap,'budget_octets',budget,
   'works',(select count(distinct value->>'work') from jsonb_array_elements(picks)),'picks',picks)) returning * into stored;
 return jsonb_build_object('task_id',task.id,'attempt',task.attempt,'sources',stored.snapshot,
  'retrieval',jsonb_build_object('mode',mode,'works',stored.retrieval->'works'),
  'consultation',jsonb_build_object('id',stored.id,'snapshot_sha256',stored.snapshot_sha256,'created_at',stored.created_at));
end $$;

do $$ declare r text; begin
 revoke all on function public.editorial_read_mcp_corpus(bigint,integer,text,text) from public,terraveler_service;
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   execute format('revoke all on function public.editorial_read_mcp_corpus(bigint,integer,text,text) from %I',r);
  end if;
 end loop;
 grant execute on function public.editorial_read_mcp_corpus(bigint,integer,text,text) to terraveler_service;
end $$;
notify pgrst,'reload schema';
commit;
