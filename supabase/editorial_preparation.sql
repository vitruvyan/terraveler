-- Canonical VPS only. Apply after editorial_team.sql and editorial_mcp_plans.sql.
-- Review of a proposed plan, not authority to enqueue or publish.
begin;
create table if not exists public.editorial_plan_preparations(
 request_id text primary key references public.editorial_plans(request_id),
 topic_id bigint not null references public.editorial_topics(id),
 expected_version integer not null check(expected_version>=0),
 plan_id bigint not null unique references public.editorial_plans(id),
 requested_url text,
 resolved_url text not null,
 planner_version_id bigint not null references public.editorial_agent_versions(id),
 reviewer_version_id bigint not null references public.editorial_agent_versions(id),
 review jsonb not null check(jsonb_typeof(review)='object' and octet_length(review::text)<=65536),
 created_at timestamptz not null default clock_timestamp(),
 check(planner_version_id<>reviewer_version_id)
);
alter table public.editorial_plan_preparations enable row level security;
revoke all on public.editorial_plan_preparations from public,terraveler_service;
grant select on public.editorial_plan_preparations to terraveler_service;
drop policy if exists preparation_service_read on public.editorial_plan_preparations;
create policy preparation_service_read on public.editorial_plan_preparations for select to terraveler_service using(true);
drop trigger if exists preparation_immutable on public.editorial_plan_preparations;
create trigger preparation_immutable before update or delete or truncate on public.editorial_plan_preparations
 for each statement execute function public.editorial_append_only();

create or replace function public.editorial_record_preparation(
 p_topic_id bigint,p_expected_version integer,p_request_id text,p_requested_url text,p_resolved_url text,
 p_plan jsonb,p_planner_version_id bigint,p_reviewer_version_id bigint,p_review jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare prior public.editorial_plan_preparations; saved public.editorial_plan_preparations; ack jsonb;
 planner public.editorial_agent_versions; reviewer public.editorial_agent_versions; k text; issue jsonb;
begin
 if p_topic_id is null or p_topic_id<=0 or p_expected_version is null or p_expected_version not between 0 and 2147483646
 or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$'
 or p_resolved_url is null or length(p_resolved_url) not between 1 and 2000
 or (p_requested_url is not null and p_requested_url<>p_resolved_url)
 then raise exception 'invalid preparation request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-plan-request:'||p_request_id,0));
 select * into prior from public.editorial_plan_preparations where request_id=p_request_id;
 if found then
  if prior.topic_id is distinct from p_topic_id or prior.expected_version is distinct from p_expected_version
   or prior.requested_url is distinct from p_requested_url then raise exception 'preparation idempotency conflict'; end if;
  return (to_jsonb(prior)-'request_id'-'created_at')||jsonb_build_object('replayed',true);
 end if;
 if p_review is null or jsonb_typeof(p_review)<>'object' or octet_length(p_review::text)>65536
  or exists(select 1 from jsonb_object_keys(p_review) k where k not in ('verdict','issues'))
  or jsonb_typeof(p_review->'verdict') is distinct from 'string'
  or p_review->>'verdict' not in ('adequate-for-next-stage','changes-requested','blocked')
  or jsonb_typeof(p_review->'issues') is distinct from 'array'
 then raise exception 'invalid plan review'; end if;
 if jsonb_array_length(p_review->'issues')>30
  or ((p_review->>'verdict'='adequate-for-next-stage')<>(jsonb_array_length(p_review->'issues')=0))
 then raise exception 'invalid plan review issues'; end if;
 for issue in select value from jsonb_array_elements(p_review->'issues') loop
  if jsonb_typeof(issue)<>'string' or length(issue#>>'{}') not between 1 and 2000 or (issue#>>'{}') !~ '[^[:space:]]' then raise exception 'invalid plan review issue'; end if;
 end loop;
 select * into planner from public.editorial_agent_versions where id=p_planner_version_id;
 select * into reviewer from public.editorial_agent_versions where id=p_reviewer_version_id;
 if planner.id is null or reviewer.id is null or planner.agent_key=reviewer.agent_key
  or planner.role<>'coordinator' or reviewer.role<>'reviewer' then raise exception 'independent configured agents required'; end if;
 -- Same locks used by configuration writes; sorted to avoid lock order inversion.
 for k in select unnest(array[planner.agent_key,reviewer.agent_key]) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||k,0));
 end loop;
 if not exists(select 1 from public.editorial_agents_current where id=planner.id and enabled)
 or not exists(select 1 from public.editorial_agents_current where id=reviewer.id and enabled)
 then raise exception 'preparation agent changed or paused'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or jsonb_typeof(p_plan->'work_items') is distinct from 'array'
 then raise exception 'invalid plan'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'work_items') item where item->'source_receipt_ids' is distinct from '[]'::jsonb)
 then raise exception 'preparation cannot claim completed source analysis'; end if;
 if not exists(select 1 from public.editorial_mcp_consultations where id::text=lower(p_plan->>'orientation_receipt_id')
  and tool='get_wikipedia_outline' and arguments->>'url'=p_resolved_url) then raise exception 'orientation does not match preparation'; end if;
 -- Existing validator independently checks the source receipt, complete revision, DAG and version.
 ack:=public.editorial_save_plan(p_topic_id,p_expected_version,p_request_id,p_plan);
 if ack->>'replayed'='true' then raise exception 'request already used by another plan path'; end if;
 insert into public.editorial_plan_preparations(request_id,topic_id,expected_version,plan_id,requested_url,resolved_url,planner_version_id,reviewer_version_id,review)
 values(p_request_id,p_topic_id,p_expected_version,(ack->>'id')::bigint,p_requested_url,p_resolved_url,planner.id,reviewer.id,p_review)
 returning * into saved;
 return (to_jsonb(saved)-'request_id'-'created_at')||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.editorial_record_preparation(bigint,integer,text,text,text,jsonb,bigint,bigint,jsonb) from public,terraveler_service;
grant execute on function public.editorial_record_preparation(bigint,integer,text,text,text,jsonb,bigint,bigint,jsonb) to terraveler_service;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
 if exists(select 1 from pg_roles where rolname=r) then
 execute format('revoke all on public.editorial_plan_preparations from %I',r);
 execute format('revoke all on function public.editorial_record_preparation(bigint,integer,text,text,text,jsonb,bigint,bigint,jsonb) from %I',r);
 end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
