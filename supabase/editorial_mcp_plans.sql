-- Canonical VPS PostgreSQL, not Supabase Auth. Apply after current editorial migrations.
-- Server-owned source-read receipts and proposed plans; no execution/publication gate.
begin;

create table if not exists public.editorial_mcp_consultations (
 id uuid primary key default gen_random_uuid(),
 tool text not null check(tool in ('get_wikipedia_outline','fetch_source_text')),
 arguments jsonb not null check(jsonb_typeof(arguments)='object' and octet_length(arguments::text)<=8192),
 arguments_sha256 text not null check(arguments_sha256 ~ '^[a-f0-9]{64}$'),
 response_text text not null check(octet_length(response_text) between 2 and 1048576),
 response jsonb not null check(jsonb_typeof(response)='object' and response=response_text::jsonb),
 response_sha256 text not null check(response_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists editorial_mcp_consultations_created_idx on public.editorial_mcp_consultations(created_at,id);
create table if not exists public.editorial_plans (
 id bigint generated always as identity primary key,
 topic_id bigint not null references public.editorial_topics(id),
 version integer not null check(version>0),
 expected_version integer not null check(expected_version>=0),
 request_id text unique not null check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
 orientation_receipt_id uuid not null references public.editorial_mcp_consultations(id),
 plan jsonb not null check(jsonb_typeof(plan)='object' and octet_length(plan::text)<=262144),
 state text not null default 'proposed' check(state='proposed'),
 created_at timestamptz not null default clock_timestamp(),
 unique(topic_id,version),
 check(version=expected_version+1)
);
create index if not exists editorial_plans_orientation_idx on public.editorial_plans(orientation_receipt_id);

-- Immutability includes owner mistakes. This is operational history, not proof
-- against an owner who deliberately changes schema.
do $$ declare n text; begin
 foreach n in array array['editorial_mcp_consultations','editorial_plans'] loop
  execute format('drop trigger if exists editorial_preparation_immutable on public.%I',n);
  execute format('create trigger editorial_preparation_immutable before update or delete or truncate on public.%I for each statement execute function public.editorial_append_only()',n);
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_preparation_service_read on public.%I',n);
  execute format('create policy editorial_preparation_service_read on public.%I for select to terraveler_service using(true)',n);
 end loop;
end $$;
revoke all on sequence public.editorial_plans_id_seq from public,terraveler_service;

create or replace function public.editorial_record_mcp_consultation(
 p_tool text,p_arguments jsonb,p_response_text text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare body jsonb; rec public.editorial_mcp_consultations; begin
 if p_tool is null or p_tool not in ('get_wikipedia_outline','fetch_source_text')
  or p_arguments is null or jsonb_typeof(p_arguments)<>'object' or octet_length(p_arguments::text)>8192
  or p_response_text is null or octet_length(p_response_text) not between 2 and 1048576
 then raise exception 'invalid MCP consultation'; end if;
 begin body:=p_response_text::jsonb;
 exception when invalid_text_representation then raise exception 'invalid MCP response JSON'; end;
 if jsonb_typeof(body) is distinct from 'object'
  or jsonb_typeof(p_arguments->'url') is distinct from 'string'
  or length(p_arguments->>'url') not between 1 and 2000
  or jsonb_typeof(body->'text') is distinct from 'string' or (body->>'text') !~ '[^[:space:]]'
 then raise exception 'source response text and URL required'; end if;
 if p_tool='get_wikipedia_outline' then
  if exists(select 1 from jsonb_object_keys(p_arguments) as k where k<>'url')
   or (p_arguments->>'url') !~ '^https://[a-z][a-z0-9-]{1,19}[.]wikipedia[.]org/wiki/[^?#]+$'
   or body->>'requested_url' is distinct from p_arguments->>'url'
   or body->>'kind' is distinct from 'wikipedia-orientation'
   or body->>'purpose' is distinct from 'planning-only'
   or jsonb_typeof(body->'revision_id') is distinct from 'number'
   or (body->>'revision_id') !~ '^[0-9]{1,16}$'
   or jsonb_typeof(body->'sections') is distinct from 'array'
   or jsonb_typeof(body->'text_truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'sections_truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'external_links_truncated') is distinct from 'boolean'
  then raise exception 'invalid orientation response'; end if;
  if (body->>'revision_id')::bigint not between 1 and 9007199254740991
  then raise exception 'invalid orientation revision'; end if;
 else
  if exists(select 1 from jsonb_object_keys(p_arguments) as k where k not in ('url','kind','lang'))
   or jsonb_typeof(p_arguments->'kind') is distinct from 'string'
   or p_arguments->>'kind' not in ('gutenberg','wikipedia','wikisource','archive','pares')
   or body->>'url' is distinct from p_arguments->>'url'
   or body->>'kind' is distinct from p_arguments->>'kind'
   or coalesce(body->'lang','null'::jsonb) is distinct from coalesce(p_arguments->'lang','null'::jsonb)
   or jsonb_typeof(body->'truncated') is distinct from 'boolean'
   or jsonb_typeof(body->'total_length') is distinct from 'number'
  then raise exception 'invalid source response'; end if;
 end if;
 -- Compute the digests from server-supplied snapshot bytes, never caller hashes.
 insert into public.editorial_mcp_consultations(tool,arguments,arguments_sha256,response_text,response,response_sha256)
 values(p_tool,p_arguments,encode(sha256(convert_to(p_arguments::text,'UTF8')),'hex'),
  p_response_text,body,encode(sha256(convert_to(p_response_text,'UTF8')),'hex')) returning * into rec;
 return jsonb_build_object('id',rec.id,'response_sha256',rec.response_sha256,
  'arguments_sha256',rec.arguments_sha256,'created_at',rec.created_at);
end $$;
revoke all on function public.editorial_record_mcp_consultation(text,jsonb,text) from public,terraveler_service;
grant execute on function public.editorial_record_mcp_consultation(text,jsonb,text) to terraveler_service;

create or replace function public.editorial_save_plan(
 p_topic_id bigint,p_expected_version integer,p_request_id text,p_plan jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare existing public.editorial_plans; saved public.editorial_plans;
 orientation public.editorial_mcp_consultations; current_version integer;
 item jsonb; gap jsonb; dep jsonb; source_id jsonb;
 names text[]:=array[]::text[]; resolved text[]:=array[]::text[];
 name text; before_count integer; pass integer; begin
 if p_topic_id is null or p_topic_id<=0 or p_expected_version is null or p_expected_version not between 0 and 2147483646
  or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$'
  or p_plan is null or jsonb_typeof(p_plan)<>'object' or octet_length(p_plan::text)>262144
 then raise exception 'invalid editorial plan'; end if;
 -- Request first, then topic: retries must replay before checking today's version.
 perform pg_advisory_xact_lock(hashtextextended('editorial-plan-request:'||p_request_id,0));
 select * into existing from public.editorial_plans where request_id=p_request_id;
 if found then
  if existing.topic_id is distinct from p_topic_id or existing.expected_version is distinct from p_expected_version or existing.plan is distinct from p_plan
  then raise exception 'plan idempotency conflict'; end if;
  return jsonb_build_object('id',existing.id,'topic_id',existing.topic_id,'version',existing.version,'state',existing.state,'replayed',true);
 end if;
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 select coalesce(max(version),0) into current_version from public.editorial_plans where topic_id=p_topic_id;
 if current_version<>p_expected_version then raise exception 'plan version conflict'; end if;
 if exists(select 1 from jsonb_object_keys(p_plan) as k where k not in ('orientation_receipt_id','gaps','work_items'))
  or jsonb_typeof(p_plan->'orientation_receipt_id') is distinct from 'string'
  or coalesce(p_plan->>'orientation_receipt_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_plan->'gaps') is distinct from 'array'
  or jsonb_typeof(p_plan->'work_items') is distinct from 'array'
 then raise exception 'invalid plan structure'; end if;
 if jsonb_array_length(p_plan->'gaps')>50 or jsonb_array_length(p_plan->'work_items') not between 1 and 50
 then raise exception 'invalid plan size'; end if;
 select * into orientation from public.editorial_mcp_consultations where id=(p_plan->>'orientation_receipt_id')::uuid;
 if not found or orientation.tool<>'get_wikipedia_outline'
  or orientation.response->'text_truncated' is distinct from 'false'::jsonb
  or orientation.response->'sections_truncated' is distinct from 'false'::jsonb
  or orientation.response->'external_links_truncated' is distinct from 'false'::jsonb
 then raise exception 'complete MCP orientation required'; end if;
 if jsonb_array_length(orientation.response->'sections')=0 then raise exception 'orientation has no usable section tree'; end if;
 for gap in select value from jsonb_array_elements(p_plan->'gaps') loop
  if jsonb_typeof(gap)<>'string' or length(gap#>>'{}') not between 1 and 2000 or (gap#>>'{}') !~ '[^[:space:]]' then raise exception 'invalid plan gap'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_plan->'work_items') loop
  if jsonb_typeof(item)<>'object' then raise exception 'invalid work item'; end if;
  if exists(select 1 from jsonb_object_keys(item) as k where k not in ('id','question','deliverable','specialty','depends_on','source_receipt_ids'))
   or jsonb_typeof(item->'id') is distinct from 'string' or coalesce(item->>'id','') !~ '^[a-z][a-z0-9_-]{0,79}$'
   or jsonb_typeof(item->'question') is distinct from 'string' or length(item->>'question') not between 1 and 2000 or (item->>'question') !~ '[^[:space:]]'
   or jsonb_typeof(item->'deliverable') is distinct from 'string' or length(item->>'deliverable') not between 1 and 2000 or (item->>'deliverable') !~ '[^[:space:]]'
   or jsonb_typeof(item->'specialty') is distinct from 'string'
   or item->>'specialty' not in ('managing-editor','history','ethnohistory','itinerary','iconography','diary','caption','editorial','copyedit','factcheck')
   or jsonb_typeof(item->'depends_on') is distinct from 'array'
   or jsonb_typeof(item->'source_receipt_ids') is distinct from 'array'
  then raise exception 'invalid work item fields'; end if;
  name:=item->>'id';
  if name=any(names) then raise exception 'duplicate work item'; end if;
  names:=array_append(names,name);
  if jsonb_array_length(item->'depends_on')>50 or jsonb_array_length(item->'source_receipt_ids')>40 then raise exception 'work item references exceed limit'; end if;
  for dep in select value from jsonb_array_elements(item->'depends_on') loop
   if jsonb_typeof(dep)<>'string' or coalesce(dep#>>'{}','') !~ '^[a-z][a-z0-9_-]{0,79}$' then raise exception 'invalid dependency'; end if;
  end loop;
  for source_id in select value from jsonb_array_elements(item->'source_receipt_ids') loop
   if jsonb_typeof(source_id)<>'string' or coalesce(source_id#>>'{}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then raise exception 'invalid source receipt'; end if;
   perform 1 from public.editorial_mcp_consultations where id=(source_id#>>'{}')::uuid;
   if not found then raise exception 'source receipt not found'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(item->'depends_on'))<>(select count(distinct value) from jsonb_array_elements_text(item->'depends_on'))
   or (select count(*) from jsonb_array_elements_text(item->'source_receipt_ids'))<>(select count(distinct value) from jsonb_array_elements_text(item->'source_receipt_ids'))
  then raise exception 'duplicate work item reference'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_plan->'work_items') loop
  for dep in select value from jsonb_array_elements(item->'depends_on') loop
   if not ((dep#>>'{}')=any(names)) then raise exception 'dependency not found'; end if;
  end loop;
 end loop;
 -- Bounded Kahn pass: a missing dependency or cycle cannot produce a proposed plan.
 for pass in 1..cardinality(names) loop
  before_count:=cardinality(resolved);
  for item in select value from jsonb_array_elements(p_plan->'work_items') loop
   name:=item->>'id';
   if not (name=any(resolved)) and not exists(select 1 from jsonb_array_elements_text(item->'depends_on') d where not (d.value=any(resolved))) then resolved:=array_append(resolved,name); end if;
  end loop;
  exit when cardinality(resolved)=cardinality(names);
  if before_count=cardinality(resolved) then raise exception 'cyclic work item dependencies'; end if;
 end loop;
 insert into public.editorial_plans(topic_id,version,expected_version,request_id,orientation_receipt_id,plan)
 values(p_topic_id,current_version+1,p_expected_version,p_request_id,orientation.id,p_plan) returning * into saved;
 return jsonb_build_object('id',saved.id,'topic_id',saved.topic_id,'version',saved.version,'state',saved.state,'replayed',false);
end $$;
revoke all on function public.editorial_save_plan(bigint,integer,text,jsonb) from public,terraveler_service;
grant execute on function public.editorial_save_plan(bigint,integer,text,jsonb) to terraveler_service;

-- Override old broad default grants, where these application roles exist.
do $$ declare r text; n text; begin
 foreach r in array array['anon','authenticated','terraveler_editorial_worker'] loop
  if exists(select 1 from pg_roles where rolname=r) then
   foreach n in array array['editorial_mcp_consultations','editorial_plans'] loop execute format('revoke all on public.%I from %I',n,r); end loop;
   execute format('revoke all on sequence public.editorial_plans_id_seq from %I',r);
   execute format('revoke all on function public.editorial_record_mcp_consultation(text,jsonb,text) from %I',r);
   execute format('revoke all on function public.editorial_save_plan(bigint,integer,text,jsonb) from %I',r);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
