-- Durable editorial foundation. Apply on canonical VPS PostgreSQL AFTER
-- governance_schema.sql. Polling is authoritative; Redis is only a wake-up aid.
-- No publication writes, no automatic promotion of generated prose to evidence.
begin;
create table if not exists public.editorial_topics (
  id bigint generated always as identity primary key,
  topic_key text unique not null check(topic_key ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  title text not null check(length(title) between 1 and 240),
  objective text not null check(length(objective) between 1 and 12000),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.editorial_topic_submissions (
  submission_id bigint primary key references public.submissions(id),
  topic_id bigint not null references public.editorial_topics(id),
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists editorial_topic_sources_idx on public.editorial_topic_submissions(topic_id);
create table if not exists public.editorial_tasks (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.editorial_topics(id),
  role text not null check(role in ('research','writer','reviewer')),
  task_key text not null check(length(task_key) between 1 and 160),
  input jsonb not null check(jsonb_typeof(input)='object'),
  dependency_id bigint references public.editorial_tasks(id),
  state text not null default 'queued' check(state in ('queued','running','completed','attention')),
  attempt integer not null default 0,
  max_attempts integer not null default 3 check(max_attempts between 1 and 5),
  worker text, lease_token uuid, lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(topic_id,task_key),
  check(attempt between 0 and max_attempts),
  check((state='running') = (lease_token is not null and lease_expires_at is not null and worker is not null))
);
create index if not exists editorial_tasks_ready_idx on public.editorial_tasks(id) where state='queued';
create index if not exists editorial_tasks_expiry_idx on public.editorial_tasks(lease_expires_at) where state='running';
create index if not exists editorial_tasks_topic_idx on public.editorial_tasks(topic_id,id);
create table if not exists public.editorial_results (
  id bigint generated always as identity primary key,
  task_id bigint unique not null references public.editorial_tasks(id),
  lease_token uuid not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  trace jsonb not null check(jsonb_typeof(trace) in ('object','array')),
  -- An artifact is a candidate. This table cannot authorize publication.
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.editorial_task_events (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.editorial_tasks(id),
  event text not null,
  attempt integer not null,
  worker text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists editorial_task_events_task_idx on public.editorial_task_events(task_id,id);

create or replace function public.editorial_append_only() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'editorial history is append-only'; end; $$;
-- Also protect history from accidental direct owner updates. An owner can of
-- course change schema; this is operational immutability, not external proof.
do $$ declare n text; begin
  foreach n in array array['editorial_topics','editorial_topic_submissions','editorial_results','editorial_task_events'] loop
    execute format('drop trigger if exists editorial_history_immutable on public.%I',n);
    execute format('create trigger editorial_history_immutable before update or delete or truncate on public.%I for each statement execute function public.editorial_append_only()',n);
  end loop;
end $$;

create or replace function public.editorial_enqueue(
 p_topic_id bigint,p_role text,p_key text,p_input jsonb,p_dependency_id bigint default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; begin
 if p_role is null or p_role not in ('research','writer','reviewer') or p_key is null or length(p_key) not between 1 and 160
   or p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid task'; end if;
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 if p_dependency_id is not null and not exists(select 1 from public.editorial_tasks where id=p_dependency_id and topic_id=p_topic_id) then
   raise exception 'dependency must belong to topic'; end if;
 select * into t from public.editorial_tasks where topic_id=p_topic_id and task_key=p_key;
 if found then
   if t.role is distinct from p_role or t.input is distinct from p_input or t.dependency_id is distinct from p_dependency_id then raise exception 'idempotency conflict'; end if;
   return to_jsonb(t);
 end if;
 insert into public.editorial_tasks(topic_id,role,task_key,input,dependency_id) values(p_topic_id,p_role,p_key,p_input,p_dependency_id) returning * into t;
 insert into public.editorial_task_events(task_id,event,attempt) values(t.id,'queued',0);
 return to_jsonb(t);
end $$;

create or replace function public.editorial_start(p_submission_id bigint,p_topic_key text,p_title text,p_objective text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare s public.submissions; d public.editorial_topics; existing bigint; task jsonb; replayed bool; begin
 if p_topic_key is null or p_topic_key !~ '^[a-z0-9][a-z0-9-]{0,99}$' or p_title is null or length(trim(p_title)) not between 1 and 240
   or p_objective is null or length(trim(p_objective)) not between 1 and 12000 then raise exception 'invalid dossier'; end if;
 -- Serialize same key before creating the dossier and lock the source so an
 -- approval cannot be revoked halfway through the snapshot.
 perform pg_advisory_xact_lock(hashtextextended('editorial-topic:'||p_topic_key,0));
 select * into s from public.submissions where id=p_submission_id for update;
 if not found or s.status<>'approved' then raise exception 'approved submission required'; end if;
 select * into d from public.editorial_topics where topic_key=p_topic_key;
 if found then
   if d.title<>trim(p_title) or d.objective<>trim(p_objective) then raise exception 'idempotency conflict'; end if;
 else
   insert into public.editorial_topics(topic_key,title,objective) values(p_topic_key,trim(p_title),trim(p_objective)) returning * into d;
 end if;
 select topic_id into existing from public.editorial_topic_submissions where submission_id=p_submission_id;
 replayed:=found;
 if replayed and existing<>d.id then raise exception 'submission already linked to another topic'; end if;
 if not replayed then
   insert into public.editorial_topic_submissions(submission_id,topic_id,snapshot) values(s.id,d.id,to_jsonb(s));
 end if;
 -- Each new contribution has its own intake task inside one shared dossier.
 -- A completed intake is never silently reused for newly attached material.
 task:=public.editorial_enqueue(d.id,'research','source:'||s.id::text,jsonb_build_object('submission_id',s.id));
 return jsonb_build_object('topic_id',d.id,'task_id',task->'id','replayed',replayed);
end $$;

create or replace function public.editorial_claim(p_worker text,p_roles text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; context jsonb; begin
 if p_worker is null or length(trim(p_worker)) not between 1 and 160 or p_roles is null or cardinality(p_roles)=0 or array_position(p_roles,null) is not null
 or not p_roles <@ array['research','writer','reviewer']::text[] or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid claim'; end if;
 select * into t from public.editorial_tasks x where x.state='queued' and x.role=any(p_roles) and x.attempt<x.max_attempts
 and (x.dependency_id is null or exists(select 1 from public.editorial_tasks dep where dep.id=x.dependency_id and dep.state='completed'))
 order by x.id for update skip locked limit 1;
 if not found then return null; end if;
 update public.editorial_tasks set state='running',attempt=attempt+1,worker=p_worker,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) where id=t.id returning * into t;
 insert into public.editorial_task_events(task_id,event,attempt,worker,detail) values(t.id,'claimed',t.attempt,p_worker,jsonb_build_object('lease_token',t.lease_token));
 select jsonb_build_object('topic',to_jsonb(d),'sources',coalesce((select jsonb_agg(snapshot order by submission_id) from public.editorial_topic_submissions where topic_id=t.topic_id),'[]'::jsonb),
 'dependency_result',(select result from public.editorial_results where task_id=t.dependency_id)) into context from public.editorial_topics d where d.id=t.topic_id;
 return to_jsonb(t)||context;
end $$;

create or replace function public.editorial_renew(p_task_id bigint,p_token uuid,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; begin
 if p_lease_seconds is null or p_lease_seconds not between 10 and 600 then raise exception 'invalid lease'; end if;
 -- Recheck expiry AFTER acquiring the row lock: waiting for another transaction
 -- must not revive a lease which expired while this renewal was blocked.
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_token or t.lease_expires_at<=clock_timestamp() then return false; end if;
 update public.editorial_tasks set lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds) where id=t.id;
 return true;
end $$;

create or replace function public.editorial_complete(p_task_id bigint,p_token uuid,p_result jsonb,p_trace jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; r public.editorial_results; begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or p_trace is null or jsonb_typeof(p_trace) not in ('object','array') then raise exception 'invalid result'; end if;
 if octet_length(p_result::text)>1048576 or octet_length(p_trace::text)>8388608 then raise exception 'result or trace too large'; end if;
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found then raise exception 'task not found'; end if;
 select * into r from public.editorial_results where task_id=p_task_id;
 if found then
  if r.lease_token is distinct from p_token or r.result is distinct from p_result or r.trace is distinct from p_trace then raise exception 'completion conflict'; end if;
  return jsonb_build_object('result_id',r.id,'replayed',true);
 end if;
 if t.state<>'running' or t.lease_token is distinct from p_token or t.lease_expires_at<=clock_timestamp() then raise exception 'stale lease'; end if;
 insert into public.editorial_results(task_id,lease_token,result,trace) values(p_task_id,p_token,p_result,p_trace) returning * into r;
 insert into public.editorial_task_events(task_id,event,attempt,worker) values(t.id,'completed',t.attempt,t.worker);
 update public.editorial_tasks set state='completed',worker=null,lease_token=null,lease_expires_at=null where id=t.id;
 return jsonb_build_object('result_id',r.id,'replayed',false);
end $$;

create or replace function public.editorial_fail(p_task_id bigint,p_token uuid,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; begin
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_token or t.lease_expires_at<=clock_timestamp() then return false; end if;
 insert into public.editorial_task_events(task_id,event,attempt,worker,detail) values(t.id,'failed',t.attempt,t.worker,jsonb_build_object('error',left(coalesce(p_error,'unspecified'),2000)));
 update public.editorial_tasks set state=case when attempt>=max_attempts then 'attention' else 'queued' end,worker=null,lease_token=null,lease_expires_at=null where id=t.id;
 return true;
end $$;

create or replace function public.editorial_recover() returns integer
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; n integer:=0; begin
 for t in select * from public.editorial_tasks where state='running' and lease_expires_at<=clock_timestamp() order by id for update skip locked limit 100 loop
  insert into public.editorial_task_events(task_id,event,attempt,worker) values(t.id,'lease-expired',t.attempt,t.worker);
  update public.editorial_tasks set state=case when attempt>=max_attempts then 'attention' else 'queued' end,worker=null,lease_token=null,lease_expires_at=null where id=t.id;
  n:=n+1;
 end loop;
 return n;
end $$;

-- Explicit revokes override earlier broad default privileges in this schema.
-- Only read access to tables; all changes go through the fenced RPCs.
do $$ declare n text; f record; begin
 foreach n in array array['editorial_topics','editorial_topic_submissions','editorial_tasks','editorial_results','editorial_task_events'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_service_read on public.%I',n);
  execute format('create policy editorial_service_read on public.%I for select to terraveler_service using(true)',n);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in
 ('editorial_append_only','editorial_start','editorial_enqueue','editorial_claim','editorial_renew','editorial_complete','editorial_fail','editorial_recover') loop
  execute format('revoke all on function %s from public,terraveler_service',f.signature);
  if f.proname<>'editorial_append_only' then execute format('grant execute on function %s to terraveler_service',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
