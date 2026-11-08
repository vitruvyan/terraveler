-- Canonical VPS PostgreSQL, after editorial_pipeline.sql. Chat can prepare work,
-- never publish. Identity/configuration is frozen; current pause still revokes it.
begin;
create table if not exists public.editorial_chat_requests (
 request_id text primary key check(length(request_id) between 8 and 160),
 topic_id bigint not null references public.editorial_topics(id),
 message text not null check(length(message) between 1 and 12000),
 agent_version_id bigint references public.editorial_agent_versions(id),
 state text not null check(state in ('running','completed','failed')),
 attempt integer not null check(attempt between 0 and 3),
 lease_token uuid, lease_expires_at timestamptz, completed_token uuid,
 reply text, model_reply text, action text check(action in ('reply','start_pipeline')), brief text,
 action_receipt jsonb, error text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((state='running')=(lease_token is not null and lease_expires_at is not null))
);
create index if not exists editorial_chat_requests_topic_idx on public.editorial_chat_requests(topic_id,created_at);
create table if not exists public.editorial_chat_messages (
 id bigint generated always as identity primary key,
 request_id text not null references public.editorial_chat_requests(request_id),
 topic_id bigint not null references public.editorial_topics(id),
 role text not null check(role in ('user','assistant')),
 content text not null check(length(content) between 1 and 12000),
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,role)
);
create index if not exists editorial_chat_messages_topic_idx on public.editorial_chat_messages(topic_id,id);
drop trigger if exists editorial_chat_messages_immutable on public.editorial_chat_messages;
create trigger editorial_chat_messages_immutable before update or delete or truncate on public.editorial_chat_messages for each statement execute function public.editorial_append_only();

create or replace function public.editorial_chat_agent(p_version_id bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare frozen public.editorial_agent_versions; current_agent public.editorial_agent_versions; begin
 select * into frozen from public.editorial_agent_versions where id=p_version_id;
 if not found or frozen.role<>'coordinator' then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-agent:'||frozen.agent_key,0));
 select * into current_agent from public.editorial_agent_versions where agent_key=frozen.agent_key order by version desc limit 1;
 if not found or not current_agent.enabled or current_agent.role<>'coordinator' then return null; end if;
 return jsonb_build_object('agent_key',frozen.agent_key,'version',frozen.version,'name',frozen.name,'role',frozen.role,'model',frozen.model,'instructions',frozen.instructions);
end $$;

create or replace function public.editorial_chat_begin(p_topic_id bigint,p_message text,p_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.editorial_chat_requests; chosen public.editorial_agent_versions; cfg jsonb; begin
 if p_message is null or length(trim(p_message)) not between 1 and 12000 or p_request_id is null or length(p_request_id) not between 8 and 160 then raise exception 'invalid chat request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-chat:'||p_request_id,0));
 select * into r from public.editorial_chat_requests where request_id=p_request_id for update;
 if found then
  if r.topic_id is distinct from p_topic_id or r.message is distinct from trim(p_message) then raise exception 'chat idempotency conflict'; end if;
  if r.state='completed' then return jsonb_build_object('request_id',r.request_id,'state',r.state,'reply',r.reply,'action_receipt',r.action_receipt); end if;
  if r.state='running' and r.lease_expires_at>clock_timestamp() then return jsonb_build_object('request_id',r.request_id,'state',r.state,'error','request-in-progress'); end if;
  if r.attempt>=3 then
   update public.editorial_chat_requests set state='failed',lease_token=null,lease_expires_at=null,error='retry-limit',updated_at=clock_timestamp() where request_id=r.request_id;
   return jsonb_build_object('request_id',r.request_id,'state','failed','error','retry-limit');
  end if;
  if r.agent_version_id is null then
   for chosen in select v.* from public.editorial_agents_current c join public.editorial_agent_versions v on v.id=c.id where c.role='coordinator' and c.enabled order by c.agent_key loop
    cfg:=public.editorial_chat_agent(chosen.id); if cfg is not null then exit; end if;
   end loop;
   if cfg is not null then update public.editorial_chat_requests set agent_version_id=chosen.id where request_id=r.request_id; end if;
  else cfg:=public.editorial_chat_agent(r.agent_version_id); end if;
  if cfg is null then return jsonb_build_object('request_id',r.request_id,'state','failed','error','coordinator-unavailable'); end if;
  update public.editorial_chat_requests set state='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '180 seconds',error=null,updated_at=clock_timestamp() where request_id=r.request_id returning * into r;
 else
  perform 1 from public.editorial_topics where id=p_topic_id;
  if not found then raise exception 'topic not found'; end if;
  for chosen in select v.* from public.editorial_agents_current c join public.editorial_agent_versions v on v.id=c.id where c.role='coordinator' and c.enabled order by c.agent_key loop
   cfg:=public.editorial_chat_agent(chosen.id); if cfg is not null then exit; end if;
  end loop;
  if cfg is null then
   insert into public.editorial_chat_requests(request_id,topic_id,message,state,attempt,error) values(p_request_id,p_topic_id,trim(p_message),'failed',0,'coordinator-unavailable');
   insert into public.editorial_chat_messages(request_id,topic_id,role,content) values(p_request_id,p_topic_id,'user',trim(p_message));
   return jsonb_build_object('request_id',p_request_id,'state','failed','error','coordinator-unavailable');
  end if;
  insert into public.editorial_chat_requests(request_id,topic_id,message,agent_version_id,state,attempt,lease_token,lease_expires_at)
   values(p_request_id,p_topic_id,trim(p_message),chosen.id,'running',1,gen_random_uuid(),clock_timestamp()+interval '180 seconds') returning * into r;
  insert into public.editorial_chat_messages(request_id,topic_id,role,content) values(r.request_id,r.topic_id,'user',r.message);
 end if;
 return jsonb_build_object('request_id',r.request_id,'state',r.state,'lease_token',r.lease_token,'agent_config',cfg);
end $$;

create or replace function public.editorial_chat_complete(p_request_id text,p_lease_token uuid,p_action text,p_reply text,p_brief text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.editorial_chat_requests; receipt jsonb:=null; response_text text; begin
 if p_action is null or p_action not in ('reply','start_pipeline') or p_reply is null or length(trim(p_reply)) not between 1 and 11800
 or (p_action='start_pipeline' and (p_brief is null or length(trim(p_brief)) not between 1 and 12000)) then raise exception 'invalid chat action'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial-chat:'||p_request_id,0));
 select * into r from public.editorial_chat_requests where request_id=p_request_id for update;
 if not found then raise exception 'chat request not found'; end if;
 if r.state='completed' then
  -- Exact payload replay only. A token is no longer exposed after completion.
  if r.completed_token is distinct from p_lease_token or r.action is distinct from p_action or r.model_reply is distinct from trim(p_reply) or r.brief is distinct from (case when p_action='start_pipeline' then trim(p_brief) else null end) then raise exception 'chat completion conflict'; end if;
  return jsonb_build_object('request_id',r.request_id,'state',r.state,'reply',r.reply,'action_receipt',r.action_receipt);
 end if;
 if r.state<>'running' or r.lease_token is distinct from p_lease_token then raise exception 'stale chat lease'; end if;
 if public.editorial_chat_agent(r.agent_version_id) is null then raise exception 'coordinator unavailable'; end if;
 if r.lease_expires_at<=clock_timestamp() then raise exception 'stale chat lease'; end if;
 if p_action='start_pipeline' then
  receipt:=public.editorial_start_pipeline(r.topic_id,trim(p_brief),'chat:'||md5(r.request_id));
 end if;
 response_text:=case when p_action='start_pipeline' then 'Editorial work recorded in task #'||(receipt->>'task_id')||'. The request is queued; no completion or publication is implied.' else trim(p_reply)||E'\n\nNo new work was created by this reply.' end;
 insert into public.editorial_chat_messages(request_id,topic_id,role,content) values(r.request_id,r.topic_id,'assistant',response_text);
 update public.editorial_chat_requests set state='completed',completed_token=p_lease_token,reply=response_text,model_reply=trim(p_reply),action=p_action,brief=case when p_action='start_pipeline' then trim(p_brief) else null end,action_receipt=receipt,error=null,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where request_id=r.request_id;
 return jsonb_build_object('request_id',r.request_id,'state','completed','reply',response_text,'action_receipt',receipt);
end $$;

create or replace function public.editorial_chat_fail(p_request_id text,p_lease_token uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.editorial_chat_requests; begin
 perform pg_advisory_xact_lock(hashtextextended('editorial-chat:'||p_request_id,0));
 select * into r from public.editorial_chat_requests where request_id=p_request_id for update;
 if not found or r.state<>'running' or r.lease_token is distinct from p_lease_token or r.lease_expires_at<=clock_timestamp() then return jsonb_build_object('error','stale-chat-lease'); end if;
 -- Provider output/secrets never enter the public error channel.
 update public.editorial_chat_requests set state='failed',lease_token=null,lease_expires_at=null,error='coordinator-request-failed',updated_at=clock_timestamp() where request_id=p_request_id;
 return jsonb_build_object('request_id',p_request_id,'state','failed','error','coordinator-request-failed');
end $$;

do $$ declare n text; f record; begin
 foreach n in array array['editorial_chat_requests','editorial_chat_messages'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,terraveler_service',n);
  execute format('grant select on public.%I to terraveler_service',n);
  execute format('drop policy if exists editorial_service_read on public.%I',n);
  execute format('create policy editorial_service_read on public.%I for select to terraveler_service using(true)',n);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('editorial_chat_agent','editorial_chat_begin','editorial_chat_complete','editorial_chat_fail') loop
  execute format('revoke all on function %s from public,terraveler_service',f.signature);
  if f.proname<>'editorial_chat_agent' then execute format('grant execute on function %s to terraveler_service',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
