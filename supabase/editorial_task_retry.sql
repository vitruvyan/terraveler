-- Canonical VPS. Apply after editorial_textual_newsroom.sql.
-- Editor-authorized, audited recovery of one exhausted planned task attempt.
begin;

create or replace function public.desk_retry_editorial_task(
 p_task_id bigint,p_expected_attempt integer,p_request_id text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.editorial_tasks; m public.editorial_graph_tasks; prior public.editorial_task_events;
 reason text; new_budget integer;
begin
 if p_task_id is null or p_task_id<=0 or p_expected_attempt is null or p_expected_attempt<=0
  or p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{16,100}$'
  or p_reason is null or length(trim(p_reason)) not between 1 and 500 or p_reason ~ '[[:cntrl:]]'
 then raise exception 'invalid retry request'; end if;
 reason:=trim(p_reason);
 perform pg_advisory_xact_lock(hashtextextended('editorial-task-retry-request:'||p_request_id,0));
 select * into prior from public.editorial_task_events
  where event='editor-retry-authorized' and detail->>'request_id'=p_request_id order by id limit 1;
 if found then
  if prior.task_id is distinct from p_task_id
   or (prior.detail->>'expected_attempt')::integer is distinct from p_expected_attempt
   or prior.detail->>'reason' is distinct from reason
  then raise exception 'retry idempotency conflict'; end if;
  return jsonb_build_object('task_id',prior.task_id,'run_id',(prior.detail->>'run_id')::bigint,
   'attempt',(prior.detail->>'expected_attempt')::integer,'max_attempts',(prior.detail->>'max_attempts')::integer,'replayed',true);
 end if;
 select * into t from public.editorial_tasks where id=p_task_id for update;
 if not found then raise exception 'task not found'; end if;
 select * into m from public.editorial_graph_tasks where task_id=p_task_id;
 if not found then raise exception 'planned task required'; end if;
 if t.state<>'attention' or t.attempt<=0 or t.attempt<>t.max_attempts then raise exception 'task is not retryable'; end if;
 if t.attempt<>p_expected_attempt then raise exception 'stale task attempt'; end if;
 if t.max_attempts>=5 then raise exception 'retry budget exhausted'; end if;
 if exists(select 1 from public.editorial_results where task_id=t.id) then raise exception 'task already has result'; end if;
 new_budget:=t.max_attempts+1;
 insert into public.editorial_task_events(task_id,event,attempt,detail)
  values(t.id,'editor-retry-authorized',t.attempt,jsonb_build_object(
   'request_id',p_request_id,'expected_attempt',t.attempt,'run_id',m.run_id,
   'max_attempts',new_budget,'reason',reason,'authorized_by','desk-editor'));
 update public.editorial_tasks set state='queued',max_attempts=new_budget where id=t.id;
 return jsonb_build_object('task_id',t.id,'run_id',m.run_id,'attempt',t.attempt,
  'max_attempts',new_budget,'replayed',false);
end $$;

revoke all on function public.desk_retry_editorial_task(bigint,integer,text,text) from public,terraveler_service,terraveler_editorial_worker;
grant execute on function public.desk_retry_editorial_task(bigint,integer,text,text) to terraveler_service;

notify pgrst,'reload schema';
commit;
