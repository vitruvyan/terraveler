-- Terraveler — OAuth-native atomic write path for modern MCP clients.
-- Run AFTER supabase/mcp_write_functions.sql and the OAuth migrations.
--
-- The original stored procedures authenticate `handle + sha256(api_key)` because
-- they predate OAuth. A bearer-authenticated MCP connection already resolved to
-- one contributor must not manufacture a legacy key merely to enter those
-- procedures. These siblings preserve the same transactions, quotas and locks
-- while taking the contributor id established by the OAuth layer.

-- --------------------------------------------------------------- identity
create or replace function mcp_contributor(p_contributor_id bigint)
returns table (id bigint, handle text, rank text, err text)
language plpgsql
as $$
declare c record;
begin
  select cn.id, cn.handle, cn.rank, cn.status into c
    from contributors cn where cn.id = p_contributor_id;
  if not found then
    return query select null::bigint, null::text, null::text,
      'This OAuth connection has no contributor.'::text;
  elsif c.status <> 'active' then
    return query select null::bigint, null::text, null::text,
      'This contributor is suspended. Appeals go to the editor-in-chief.'::text;
  else
    return query select c.id, c.handle, c.rank, null::text;
  end if;
end;
$$;

-- ------------------------------------------------------------- submissions
create or replace function mcp_record_submission_oauth(
  p_contributor_id bigint, p_type text, p_target_voyage text,
  p_payload jsonb, p_status text, p_carta text, p_quotas jsonb,
  p_actor text, p_action text, p_verdict text, p_findings jsonb
) returns jsonb
language plpgsql
as $$
declare a record; used int; sid bigint; lim int;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;
  -- Serialize quota admission per contributor across serverless instances.
  perform pg_advisory_xact_lock(hashtextextended('mcp-author:' || a.id::text, 0));

  lim := coalesce((p_quotas ->> a.rank)::int, (p_quotas ->> 'cabin-boy')::int);
  select count(*) into used from submissions
   where contributor_id = a.id and created_at >= now() - interval '24 hours';
  if used >= lim then
    return jsonb_build_object('error', format(
      'Daily quota reached for rank ''%s'' (%s/24h). Quality over volume — resume tomorrow, or rise in rank.',
      a.rank, lim));
  end if;

  insert into submissions (contributor_id, type, target_voyage, payload, status, carta_version)
       values (a.id, p_type, p_target_voyage, p_payload, p_status, p_carta)
    returning id into sid;
  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (sid, p_actor, p_action, p_verdict, p_findings, p_carta);

  return jsonb_build_object('submission_id', sid, 'status', p_status);
end;
$$;

-- ------------------------------------------------------------------ claims
create or replace function mcp_claim_gap_oauth(
  p_contributor_id bigint, p_gap_id bigint,
  p_claim_limits jsonb, p_ttl_days int, p_carta text
) returns jsonb
language plpgsql
as $$
declare a record; held int; g record; lim int;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp-claim:' || a.id::text, 0));
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  update editorial_gaps set status = 'open', claimed_by = null, claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select count(*) into held from editorial_gaps
   where claimed_by = a.handle and status = 'claimed';
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active claim(s); the limit for rank ''%s'' is %s. Submit or let one expire first.',
      held, a.rank, lim));
  end if;

  update editorial_gaps
     set status = 'claimed', claimed_by = a.handle, claimed_at = now()
   where id = p_gap_id and status = 'open'
   returning id, title into g;
  if not found then
    return jsonb_build_object('error', 'gap not found or not open (already claimed/done).');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'mcp', 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('gap #%s ''%s'' claimed by %s', g.id, g.title, a.handle))),
               p_carta);

  return jsonb_build_object('claimed', jsonb_build_object('id', g.id, 'title', g.title));
end;
$$;

-- ------------------------------------------------------------- peer review
create or replace function mcp_submit_review_oauth(
  p_contributor_id bigint, p_submission_id bigint, p_verdict text,
  p_findings jsonb, p_carta text, p_quotas jsonb, p_to_advance int
) returns jsonb
language plpgsql
as $$
declare a record; s record; used int; total int; advanced boolean := false; f jsonb; lim int;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp-review:' || a.id::text, 0));

  select id, status, contributor_id into s
    from submissions where id = p_submission_id for update;
  if not found then return jsonb_build_object('error', 'no such submission'); end if;
  if s.status <> 'peer-review' then
    return jsonb_build_object('error', format('submission is in ''%s'', not open for review.', s.status));
  end if;
  if s.contributor_id = a.id then
    return jsonb_build_object('error', 'you cannot review your own draft (Carta 10.4).');
  end if;
  if exists (select 1 from reviews where submission_id = p_submission_id and reviewer_id = a.id) then
    return jsonb_build_object('error', 'you already reviewed this draft — one review per Scribe.');
  end if;

  lim := coalesce((p_quotas ->> a.rank)::int, (p_quotas ->> 'cabin-boy')::int);
  select count(*) into used from reviews
   where reviewer_id = a.id and created_at >= now() - interval '24 hours';
  if used >= lim then
    return jsonb_build_object('error', format(
      'Daily review quota reached for rank ''%s'' (%s/24h).', a.rank, lim));
  end if;

  insert into reviews (submission_id, reviewer_id, verdict, findings, carta_version)
       values (p_submission_id, a.id, p_verdict, p_findings, p_carta);

  select jsonb_agg(jsonb_build_array('REVIEW', 1,
           coalesce(e->>'claim','?') || ': ' || coalesce(e->>'assessment','?') ||
           case when e->>'evidence_url' is not null then ' (' || (e->>'evidence_url') || ')' else '' end))
    into f from jsonb_array_elements(p_findings) e;
  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (p_submission_id, 'peer-review', 'review', p_verdict, f, p_carta);

  select count(*) into total from reviews where submission_id = p_submission_id;
  if total >= p_to_advance then
    update submissions set status = 'human-review', updated_at = now()
     where id = p_submission_id and status = 'peer-review';
    if found then
      advanced := true;
      insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
           values (p_submission_id, 'peer-review', 'peer-review-complete', null,
                   jsonb_build_array(jsonb_build_array('INFO', 1,
                     format('%s reviews collected — advanced to the desk', total))),
                   p_carta);
    end if;
  end if;

  return jsonb_build_object('reviews_so_far', total, 'advanced_to_desk', advanced);
end;
$$;

-- PostgREST service role. Restart PostgREST after applying this migration so it
-- sees the new functions.
grant execute on function mcp_contributor(bigint) to terraveler_service;
grant execute on function mcp_record_submission_oauth(bigint, text, text, jsonb, text, text, jsonb, text, text, text, jsonb) to terraveler_service;
grant execute on function mcp_claim_gap_oauth(bigint, bigint, jsonb, int, text) to terraveler_service;
grant execute on function mcp_submit_review_oauth(bigint, bigint, text, jsonb, text, jsonb, int) to terraveler_service;
