-- Editor-only write seam. Apply to canonical Terraveler PostgreSQL on the VPS,
-- never Supabase Auth. Requires governance_schema.sql and chartroom_waypoints.sql.
-- Title changes are display overlays: original submissions, reviews, publication
-- bundles and statuses remain untouched. Reverting is a new rename to a prior title.
begin;

create index if not exists audit_log_editorial_request_idx
  on public.audit_log ((findings->>'request_id'))
  where actor = 'editor-in-chief' and action in ('editorial-title', 'editorial-revision-request');

create or replace function public.desk_editorial_action(
  p_action text, p_target_type text, p_target_id text, p_value text,
  p_expected_version bigint, p_request_id text, p_agent_account_id bigint,
  p_carta text
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  target_title text; target_voyage text; version_now bigint := 0;
  audit_id bigint; gap_id bigint; prior record; result jsonb; request_value jsonb;
begin
  if p_action not in ('rename', 'request-revision') or p_target_type not in ('submission','project','voyage')
     or p_target_id is null or p_value is null or length(trim(p_value)) = 0
     or length(p_value) > (case when p_action = 'rename' then 200 else 6000 end)
     or p_request_id is null or p_request_id !~ '^[a-zA-Z0-9_-]{16,100}$'
     or (p_action = 'rename' and (p_expected_version is null or p_expected_version < 0)) then
    return jsonb_build_object('error', 'invalid-action');
  end if;
  if p_target_type in ('submission','project') and p_target_id !~ '^[1-9][0-9]{0,14}$' then
    return jsonb_build_object('error', 'invalid-target');
  end if;
  if p_target_type = 'voyage' and p_target_id !~ '^[a-z0-9][a-z0-9-]{0,99}$' then
    return jsonb_build_object('error', 'invalid-target');
  end if;
  request_value := jsonb_build_object('action',p_action,'target_type',p_target_type,'target_id',p_target_id,
    'value',trim(p_value),'expected_version',p_expected_version,'agent_account_id',p_agent_account_id);
  perform pg_advisory_xact_lock(hashtextextended('desk-edit-request:' || p_request_id, 0));
  select findings into prior from audit_log
    where actor='editor-in-chief' and action in ('editorial-title','editorial-revision-request')
      and findings->>'request_id'=p_request_id order by id desc limit 1;
  if found then
    if prior.findings->'request_value' is distinct from request_value then return jsonb_build_object('error','idempotency-conflict'); end if;
    return (prior.findings->'result') || jsonb_build_object('replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('desk-edit-target:' || p_target_type || ':' || p_target_id, 0));

  if p_target_type='submission' then
    select coalesce(s.payload->>'title',s.payload->'meta'->>'title',s.payload->'meta'->>'voyage_title',s.target_voyage,'Submission #' || s.id::text), s.target_voyage
      into target_title,target_voyage from submissions s where s.id=p_target_id::bigint;
    if not found then return jsonb_build_object('error','not-found'); end if;
  elsif p_target_type='project' then
    select title,context_voyage into target_title,target_voyage from editorial_gaps where id=p_target_id::bigint;
    if not found then return jsonb_build_object('error','not-found'); end if;
  else
    -- Voyage identifiers are validated against the deployed ATLAS by the editor
    -- route. The database never asserts that an overlay changes the live bundle.
    target_title := p_target_id; target_voyage := p_target_id;
  end if;
  select id,findings into prior from audit_log where actor='editor-in-chief' and action='editorial-title'
    and findings->>'target_type'=p_target_type and findings->>'target_id'=p_target_id order by id desc limit 1;
  if found then version_now := prior.id; target_title := coalesce(prior.findings->>'title',target_title); end if;
  if p_action='rename' then
    if version_now <> p_expected_version then
      return jsonb_build_object('error','conflict','title',target_title,'title_version',version_now);
    end if;
    audit_id := nextval(pg_get_serial_sequence('audit_log','id'));
    result := jsonb_build_object('action',p_action,'target_type',p_target_type,'target_id',p_target_id,
      'title',trim(p_value),'title_version',audit_id,'request_id',p_request_id,
      'next_step','Editorial title saved. Submitted prose and published titles are unchanged.');
    insert into audit_log(id,submission_id,actor,action,verdict,findings,carta_version) overriding system value
      values(audit_id,case when p_target_type='submission' then p_target_id::bigint else null end,'editor-in-chief','editorial-title',null,
        jsonb_build_object('target_type',p_target_type,'target_id',p_target_id,'title',trim(p_value),'previous_title',target_title,
          'request_id',p_request_id,'request_value',request_value,'result',result),p_carta);
  else
    if p_agent_account_id is not null and not exists(select 1 from agent_accounts where id=p_agent_account_id and status='active') then
      return jsonb_build_object('error','agent-unavailable');
    end if;
    insert into editorial_gaps(title,description,kind,priority,status,waypoint_type,context_type,context_voyage,requested_agent_account_id)
      values(left('Revision: ' || target_title,200),
        format('Editorial revision requested for %s %s. Original submissions remain unchanged. Deliver a revised draft through normal verification and review.%s%s',p_target_type,p_target_id,E'\n\n',trim(p_value)),
        'correction',2,'open','review',case when target_voyage is null then 'atlas' else 'voyage' end,target_voyage,p_agent_account_id)
      returning id into gap_id;
    result := jsonb_build_object('action',p_action,'target_type',p_target_type,'target_id',p_target_id,
      'gap_id',gap_id,'state',case when p_agent_account_id is null then 'open' else 'offered' end,'request_id',p_request_id,
      'next_step','Revision request recorded. An agent must claim the task before work begins.');
    insert into audit_log(submission_id,actor,action,verdict,findings,carta_version)
      values(case when p_target_type='submission' then p_target_id::bigint else null end,'editor-in-chief','editorial-revision-request',null,
        jsonb_build_object('target_type',p_target_type,'target_id',p_target_id,'gap_id',gap_id,'requested_agent_account_id',p_agent_account_id,
          'request_id',p_request_id,'request_value',request_value,'result',result),p_carta);
  end if;
  return result;
end;
$$;

revoke all on function public.desk_editorial_action(text,text,text,text,bigint,text,bigint,text) from public;
grant execute on function public.desk_editorial_action(text,text,text,text,bigint,text,bigint,text) to terraveler_service;
notify pgrst, 'reload schema';
commit;
