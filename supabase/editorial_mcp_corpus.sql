-- Canonical VPS, after editorial_workflow and source governance/rag migrations.
-- Private, task-scoped MCP reads. Never a public raw-corpus endpoint.
begin;
create table if not exists public.editorial_corpus_consultations(
 id uuid primary key default gen_random_uuid(),
 task_id bigint not null references public.editorial_tasks(id),
 attempt integer not null check(attempt>0),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='array' and octet_length(snapshot::text)<=24000),
 snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists editorial_corpus_attempt_idx on public.editorial_corpus_consultations(task_id,attempt);
alter table public.editorial_corpus_consultations enable row level security;
revoke all on public.editorial_corpus_consultations from public,terraveler_service;
grant select on public.editorial_corpus_consultations to terraveler_service;
drop policy if exists editorial_corpus_service_read on public.editorial_corpus_consultations;
create policy editorial_corpus_service_read on public.editorial_corpus_consultations for select to terraveler_service using(true);
drop trigger if exists editorial_corpus_immutable on public.editorial_corpus_consultations;
create trigger editorial_corpus_immutable before update or delete or truncate on public.editorial_corpus_consultations
for each statement execute function public.editorial_append_only();

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
 if coalesce(cardinality(scopes),0) not between 1 and 20 then raise exception 'editorial voyage scope required'; end if;
 for item in select id,title,left(content,2500) as content,source_url,license from public.rag_docs
  where type='text' and voyage_slug=any(scopes)
  and trim(license) ~* '^(Public domain|CC0( 1[.]0)?|CC BY(-SA)?( [1-4][.]0)?)$'
  order by id limit 40 loop
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
revoke all on function public.editorial_read_mcp_corpus(bigint,integer,text) from public,terraveler_service;
grant execute on function public.editorial_read_mcp_corpus(bigint,integer,text) to terraveler_service;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
 if exists(select 1 from pg_roles where rolname=r) then
  execute format('revoke all on public.editorial_corpus_consultations from %I',r);
  execute format('revoke all on function public.editorial_read_mcp_corpus(bigint,integer,text) from %I',r);
 end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
