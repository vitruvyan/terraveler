-- Canonical VPS PostgreSQL. Apply after editorial_agent_binding.sql.
-- Results, links and provenance are immutable; runs are a mutable status projection.
-- This scheduler never writes public content or grants publication authority.
begin;
create table if not exists public.editorial_pipeline_runs (
 id bigint generated always as identity primary key,
 topic_id bigint not null references public.editorial_topics(id),
 brief text not null check(length(brief) between 1 and 12000),
 request_id text unique not null check(length(request_id) between 8 and 160),
 state text not null check(state in ('researching','writing','reviewing','awaiting-editor','attention')),
 current_task_id bigint references public.editorial_tasks(id),
 revision integer not null default 0 check(revision between 0 and 2),
 research_task_id bigint references public.editorial_tasks(id),
 draft_task_id bigint references public.editorial_tasks(id),
 review_task_id bigint references public.editorial_tasks(id),
 attention_reason text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
drop index if exists public.editorial_pipeline_active_topic_idx;
create unique index editorial_pipeline_active_topic_idx on public.editorial_pipeline_runs(topic_id)
 where state in ('researching','writing','reviewing');
create table if not exists public.editorial_pipeline_tasks (
 task_id bigint primary key references public.editorial_tasks(id),
 run_id bigint not null references public.editorial_pipeline_runs(id),
 stage text not null check(stage in ('research','writer','reviewer')),
 revision integer not null check(revision between 0 and 2),
 created_at timestamptz not null default clock_timestamp(),
 unique(run_id,stage,revision)
);
create index if not exists editorial_pipeline_tasks_run_idx on public.editorial_pipeline_tasks(run_id);
drop trigger if exists editorial_pipeline_tasks_immutable on public.editorial_pipeline_tasks;
create trigger editorial_pipeline_tasks_immutable before update or delete or truncate on public.editorial_pipeline_tasks
 for each statement execute function public.editorial_append_only();

create or replace function public.editorial_attach(p_submission_id bigint,p_topic_key text,p_title text,p_objective text)
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
 return jsonb_build_object('topic_id',d.id,'replayed',replayed);
end $$;
revoke all on function public.editorial_attach(bigint,text,text,text) from public;
grant execute on function public.editorial_attach(bigint,text,text,text) to terraveler_service;

create or replace function public.editorial_start_pipeline(p_topic_id bigint,p_brief text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.editorial_pipeline_runs; t jsonb; begin
 if p_brief is null or length(trim(p_brief)) not between 1 and 12000 or p_request_id is null or length(p_request_id) not between 8 and 160 then raise exception 'invalid pipeline request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-pipeline:'||p_request_id,0));
 select * into r from public.editorial_pipeline_runs where request_id=p_request_id;
 if found then
  if r.topic_id is distinct from p_topic_id or r.brief is distinct from trim(p_brief) then raise exception 'pipeline idempotency conflict'; end if;
  return jsonb_build_object('run_id',r.id,'task_id',r.current_task_id,'state',r.state,'replayed',true);
 end if;
 perform 1 from public.editorial_topics where id=p_topic_id for update;
 if not found then raise exception 'topic not found'; end if;
 if not exists(select 1 from public.editorial_topic_submissions where topic_id=p_topic_id) then raise exception 'topic has no approved sources'; end if;
 if exists(select 1 from public.editorial_pipeline_runs where topic_id=p_topic_id and state in ('researching','writing','reviewing')) then raise exception 'pipeline already active for topic'; end if;
 insert into public.editorial_pipeline_runs(topic_id,brief,request_id,state) values(p_topic_id,trim(p_brief),p_request_id,'researching') returning * into r;
 t:=public.editorial_enqueue(p_topic_id,'research','pipeline:'||r.id||':research:0',jsonb_build_object('pipeline_id',r.id,'brief',r.brief,'stage','research','revision',0));
 insert into public.editorial_pipeline_tasks(task_id,run_id,stage,revision) values((t->>'id')::bigint,r.id,'research',0);
 update public.editorial_pipeline_runs set current_task_id=(t->>'id')::bigint,research_task_id=(t->>'id')::bigint where id=r.id;
 return jsonb_build_object('run_id',r.id,'task_id',(t->>'id')::bigint,'state',r.state,'replayed',false);
end $$;

create or replace function public.editorial_pipeline_advance()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare e public.editorial_pipeline_tasks; r public.editorial_pipeline_runs; t public.editorial_tasks;
 nxt jsonb; inp jsonb; next_stage text; next_revision integer; verdict text; expected_kind text; begin
 select * into e from public.editorial_pipeline_tasks where task_id=new.task_id;
 if not found then return new; end if;
 select * into r from public.editorial_pipeline_runs where id=e.run_id for update;
 -- Only the current task may advance. Historical/foreign artifacts remain evidence.
 if r.current_task_id<>new.task_id or r.state not in ('researching','writing','reviewing') then return new; end if;
 select * into t from public.editorial_tasks where id=new.task_id;
 expected_kind:=case e.stage when 'writer' then 'draft' when 'reviewer' then 'review' else 'research' end;
 if t.topic_id<>r.topic_id or t.role<>e.stage or t.state<>'running' or t.lease_token is distinct from new.lease_token
   or new.result->>'kind' is distinct from expected_kind then
  update public.editorial_pipeline_runs set state='attention',attention_reason='Invalid stage result',updated_at=clock_timestamp() where id=r.id;
  return new;
 end if;
 next_revision:=e.revision;
 if e.stage='research' then next_stage:='writer';
 elsif e.stage='writer' then
  update public.editorial_pipeline_runs set draft_task_id=new.task_id where id=r.id;
  r.draft_task_id:=new.task_id; next_stage:='reviewer';
 else
  verdict:=new.result->>'verdict';
  update public.editorial_pipeline_runs set review_task_id=new.task_id where id=r.id;
  r.review_task_id:=new.task_id;
  if verdict='ready-for-editor' then
   update public.editorial_pipeline_runs set state='awaiting-editor',updated_at=clock_timestamp() where id=r.id; return new;
  elsif verdict='changes-requested' and e.revision<2 then next_stage:='writer'; next_revision:=e.revision+1;
  else
   update public.editorial_pipeline_runs set state='attention',attention_reason=case when verdict='changes-requested' then 'Rewrite limit reached' when verdict='blocked' then 'Reviewer blocked the draft' else 'Invalid review verdict' end,updated_at=clock_timestamp() where id=r.id;
   return new;
  end if;
 end if;
 inp:=jsonb_strip_nulls(jsonb_build_object('pipeline_id',r.id,'brief',r.brief,'stage',next_stage,'revision',next_revision,'research_task_id',r.research_task_id,'draft_task_id',r.draft_task_id,'review_task_id',r.review_task_id));
 inp:=inp||jsonb_strip_nulls(jsonb_build_object('research_result',(select result from public.editorial_results where task_id=r.research_task_id),'draft_result',(select result from public.editorial_results where task_id=r.draft_task_id),'review_result',(select result from public.editorial_results where task_id=r.review_task_id)));
 nxt:=public.editorial_enqueue(r.topic_id,next_stage,'pipeline:'||r.id||':'||next_stage||':'||next_revision,inp,new.task_id);
 insert into public.editorial_pipeline_tasks(task_id,run_id,stage,revision) values((nxt->>'id')::bigint,r.id,next_stage,next_revision);
 update public.editorial_pipeline_runs set current_task_id=(nxt->>'id')::bigint,revision=next_revision,state=case next_stage when 'writer' then 'writing' else 'reviewing' end,updated_at=clock_timestamp() where id=r.id;
 return new;
end $$;
drop trigger if exists editorial_pipeline_result on public.editorial_results;
create trigger editorial_pipeline_result after insert on public.editorial_results for each row execute function public.editorial_pipeline_advance();

create or replace function public.editorial_pipeline_task_attention()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.state='attention' and old.state is distinct from new.state then
  update public.editorial_pipeline_runs r set state='attention',attention_reason='Task exhausted its retry budget',updated_at=clock_timestamp()
  from public.editorial_pipeline_tasks e where e.task_id=new.id and e.run_id=r.id and r.current_task_id=new.id and r.state in ('researching','writing','reviewing');
 end if;
 return new;
end $$;
drop trigger if exists editorial_pipeline_attention on public.editorial_tasks;
create trigger editorial_pipeline_attention after update of state on public.editorial_tasks for each row execute function public.editorial_pipeline_task_attention();

do $$ declare n text; f record; begin
 foreach n in array array['editorial_pipeline_runs','editorial_pipeline_tasks'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_service_read on public.%I',n);
  execute format('create policy editorial_service_read on public.%I for select to terraveler_service using(true)',n);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('editorial_start_pipeline','editorial_pipeline_advance','editorial_pipeline_task_attention') loop
  execute format('revoke all on function %s from public,terraveler_service',f.signature);
  if f.proname='editorial_start_pipeline' then execute format('grant execute on function %s to terraveler_service',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
