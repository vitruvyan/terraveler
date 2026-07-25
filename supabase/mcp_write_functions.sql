-- Terraveler — the MCP write path as single statements.
-- Run in psql AFTER governance_peer_review.sql, then restart terraveler_postgrest.
--
-- Why
-- ---
-- Every write tool authenticated, checked its quota, inserted and audited as
-- separate PostgREST calls: three round trips for a proposal, four for a gap
-- claim, nine for a peer review — each one a transatlantic hop, in sequence,
-- while the contributor waits.
--
-- Latency is the smaller half. Read-modify-write across separate calls is also
-- a race: two reviews arriving together could both read "one review so far" and
-- neither advance the draft, or both advance it and audit it twice; two claims
-- on the last free slot of a rank could both pass the count. Inside one
-- function each of these is a single transaction, so the outcome is whatever
-- the database decided, once.
--
-- Auth lives here too, so it costs nothing extra: the caller passes the sha256
-- of the api_key it was given (never the key), exactly as the application
-- computed it before.

-- ------------------------------------------------------------------ auth
create or replace function mcp_auth(p_handle text, p_key_hash text)
returns table (id bigint, rank text, err text)
language plpgsql
as $$
declare c record;
begin
  select cn.id, cn.rank, cn.status, cn.api_key_hash into c
    from contributors cn where cn.handle = p_handle;
  if not found then
    return query select null::bigint, null::text,
      'Unknown handle. Register first with the `register` tool.'::text;
  elsif c.api_key_hash is null then
    return query select null::bigint, null::text,
      'This handle predates personal keys — ask the editorial desk to mint one.'::text;
  elsif c.api_key_hash <> p_key_hash then
    return query select null::bigint, null::text, 'Invalid api_key for this handle.'::text;
  elsif c.status <> 'active' then
    return query select null::bigint, null::text,
      'This contributor is suspended. Appeals go to the editor-in-chief.'::text;
  else
    return query select c.id, c.rank, null::text;
  end if;
end;
$$;

-- ------------------------------------------------- submissions (ideas, drafts…)
create or replace function mcp_record_submission(
  p_handle text, p_key_hash text, p_type text, p_target_voyage text,
  p_payload jsonb, p_status text, p_carta text, p_quotas jsonb,
  p_actor text, p_action text, p_verdict text, p_findings jsonb
) returns jsonb
language plpgsql
as $$
declare a record; used int; sid bigint; lim int;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  -- The Ship's Ranks are defined once, in the application; this applies them.
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

-- ------------------------------------------------------------------ gap claims
create or replace function mcp_claim_gap(
  p_handle text, p_key_hash text, p_gap_id bigint,
  p_claim_limits jsonb, p_ttl_days int, p_carta text
) returns jsonb
language plpgsql
as $$
declare a record; held int; g record; lim int;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  -- Reopen claims whose holder went silent (legacy claims carry no timestamp).
  update editorial_gaps set status = 'open', claimed_by = null, claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select count(*) into held from editorial_gaps
   where claimed_by = p_handle and status = 'claimed';
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active claim(s); the limit for rank ''%s'' is %s. Submit or let one expire first.',
      held, a.rank, lim));
  end if;

  update editorial_gaps
     set status = 'claimed', claimed_by = p_handle, claimed_at = now()
   where id = p_gap_id and status = 'open'
   returning id, title into g;
  if not found then
    return jsonb_build_object('error', 'gap not found or not open (already claimed/done).');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'mcp', 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('gap #%s ''%s'' claimed by %s', g.id, g.title, p_handle))),
               p_carta);

  return jsonb_build_object('claimed', jsonb_build_object('id', g.id, 'title', g.title));
end;
$$;

-- ------------------------------------------------------------------ peer review
create or replace function mcp_submit_review(
  p_handle text, p_key_hash text, p_submission_id bigint, p_verdict text,
  p_findings jsonb, p_carta text, p_quotas jsonb, p_to_advance int
) returns jsonb
language plpgsql
as $$
declare a record; s record; used int; total int; advanced boolean := false; f jsonb; lim int;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  -- Lock the draft for the duration: the count below and the decision to
  -- advance must see a consistent picture even when reviews arrive together.
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

-- ------------------------------------------------------------------ grants
-- New objects arrive privilege-less for the service role (see
-- governance_peer_review.sql), and PostgREST caches the schema: after running
-- this, `docker restart terraveler_postgrest`.
grant execute on function mcp_auth(text, text) to terraveler_service;
grant execute on function mcp_record_submission(text, text, text, text, jsonb, text, text, jsonb, text, text, text, jsonb) to terraveler_service;
grant execute on function mcp_claim_gap(text, text, bigint, jsonb, int, text) to terraveler_service;
grant execute on function mcp_submit_review(text, text, bigint, text, jsonb, text, jsonb, int) to terraveler_service;
