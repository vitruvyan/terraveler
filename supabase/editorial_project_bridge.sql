-- Canonical VPS PostgreSQL. Apply after editorial_pipeline.sql and Chartroom
-- migrations. Association only: topics remain canonical editorial dossiers;
-- gaps retain the existing external contribution/claim lifecycle. No backfill.
begin;
alter table public.editorial_gaps add column if not exists source_submission_id bigint references public.submissions(id);
create unique index if not exists editorial_gaps_source_submission_uidx
 on public.editorial_gaps(source_submission_id) where source_submission_id is not null;
create table if not exists public.editorial_project_bridges (
 topic_id bigint primary key references public.editorial_topics(id),
 gap_id bigint unique not null references public.editorial_gaps(id),
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.editorial_project_bridge_requests (
 request_id text primary key check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
 topic_id bigint not null references public.editorial_topics(id),
 submission_id bigint not null references public.submissions(id),
 requested_gap_id bigint references public.editorial_gaps(id),
 gap_id bigint not null references public.editorial_gaps(id),
 created_at timestamptz not null default clock_timestamp()
);
do $$ declare n text; r text; begin
 foreach n in array array['editorial_project_bridges','editorial_project_bridge_requests'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
   if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on public.%I from %I',n,r); end if;
  end loop;
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_bridge_read on public.%I',n);
  execute format('create policy editorial_bridge_read on public.%I for select to terraveler_service using(true)',n);
  execute format('drop trigger if exists editorial_bridge_immutable on public.%I',n);
  execute format('create trigger editorial_bridge_immutable before update or delete or truncate on public.%I for each statement execute function public.editorial_append_only()',n);
 end loop;
end $$;
create or replace function public.editorial_reconcile_project(
 p_topic_id bigint,p_submission_id bigint,p_request_id text,p_gap_id bigint default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare previous public.editorial_project_bridge_requests; bridge public.editorial_project_bridges;
 source public.submissions; gap public.editorial_gaps; chosen bigint; made boolean:=false; title text; kind text;
begin
 if p_topic_id is null or p_topic_id<=0 or p_submission_id is null or p_submission_id<=0
  or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$'
  or (p_gap_id is not null and p_gap_id<=0) then raise exception 'invalid project bridge request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-project-bridge:'||p_request_id,0));
 select * into previous from public.editorial_project_bridge_requests where request_id=p_request_id;
 if found then
  if previous.topic_id is distinct from p_topic_id or previous.submission_id is distinct from p_submission_id
   or previous.requested_gap_id is distinct from p_gap_id then raise exception 'project bridge idempotency conflict'; end if;
  return jsonb_build_object('topic_id',previous.topic_id,'submission_id',previous.submission_id,'gap_id',previous.gap_id,'replayed',true);
 end if;
 select * into source from public.submissions where id=p_submission_id for update;
 if not found or source.type<>'idea' or source.status<>'approved' then raise exception 'approved idea required'; end if;
 -- Match editorial_attach's source-first lock ordering.
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 if not exists(select 1 from public.editorial_topic_submissions where submission_id=p_submission_id and topic_id=p_topic_id)
  then raise exception 'approved idea must already belong to topic'; end if;
 select * into bridge from public.editorial_project_bridges where topic_id=p_topic_id;
 if found then
  if p_gap_id is not null and p_gap_id<>bridge.gap_id then raise exception 'topic already linked to another public work item'; end if;
  chosen:=bridge.gap_id;
 else
  if p_gap_id is null then
   -- Reuse a legacy #104 work item only through its explicit origin ID.
   select * into gap from public.editorial_gaps where source_submission_id=p_submission_id for update;
  else
   select * into gap from public.editorial_gaps where id=p_gap_id for update;
   if not found then raise exception 'public work item not found'; end if;
  end if;
  if found then
   if exists(select 1 from public.editorial_project_bridges where gap_id=gap.id and topic_id<>p_topic_id)
    then raise exception 'public work item already linked to another topic'; end if;
   if gap.source_submission_id is not null and not exists(
    select 1 from public.editorial_topic_submissions ts join public.submissions origin on origin.id=ts.submission_id where ts.submission_id=gap.source_submission_id and ts.topic_id=p_topic_id and origin.type='idea' and origin.status='approved')
    then raise exception 'public work item origin conflicts with topic'; end if;
   chosen:=gap.id;
   if gap.source_submission_id is null then
    update public.editorial_gaps set source_submission_id=p_submission_id where id=gap.id;
   end if;
  else
   if jsonb_typeof(source.payload->'title') is distinct from 'string' then raise exception 'approved idea title required'; end if;
   title:=left(btrim(source.payload->>'title'),200);
   if title !~ '[^[:space:]]' then raise exception 'approved idea title required'; end if;
   kind:=case when source.payload->>'kind' in ('voyage','waypoint','media','perspective','translation','correction')
    then source.payload->>'kind' else 'voyage' end;
   insert into public.editorial_gaps(title,description,kind,priority,status,source_submission_id,initiated_by_contributor_id)
    values(title,'Approved proposal #'||p_submission_id||'. Research and drafting remain to be done. Named sources are candidates until separately consulted and verified. Claim eligibility is determined by the existing Chartroom/MCP workflow.',kind,2,'open',p_submission_id,source.contributor_id)
    returning id into chosen;
   made:=true;
  end if;
  insert into public.editorial_project_bridges(topic_id,gap_id) values(p_topic_id,chosen);
 end if;
 insert into public.editorial_project_bridge_requests(request_id,topic_id,submission_id,requested_gap_id,gap_id)
  values(p_request_id,p_topic_id,p_submission_id,p_gap_id,chosen);
 return jsonb_build_object('topic_id',p_topic_id,'submission_id',p_submission_id,'gap_id',chosen,'created',made,'replayed',false);
end $$;
revoke all on function public.editorial_reconcile_project(bigint,bigint,text,bigint) from public,terraveler_service;
grant execute on function public.editorial_reconcile_project(bigint,bigint,text,bigint) to terraveler_service;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on function public.editorial_reconcile_project(bigint,bigint,text,bigint) from %I',r); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
