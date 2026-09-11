-- Fix: mcp_claim_gap and mcp_claim_gap_oauth crash on every call.
--
-- Both functions declare `g record;` for the final claiming UPDATE's
-- RETURNING ... INTO target, then separately alias `editorial_gaps` as `g`
-- in an earlier reservation-lookup SELECT ("select g.requested_agent_account_id
-- ... from editorial_gaps g ..."). PL/pgSQL's variable substitution matches
-- `g.column` against the declared record variable `g` before it considers
-- the SQL alias, and that variable has no assigned row yet at that point in
-- the function — so every call fails with "record \"g\" is not assigned yet"
-- (55000, "tuple structure of a not-yet-assigned record is indeterminate"),
-- before the reservation or quota checks ever run.
--
-- This was found live: claim_gap over the modern OAuth lane returned a bare
-- "protected mutation failed" (the write route's catch-all), and calling
-- mcp_claim_gap_oauth directly surfaced the real 55000 error above.
--
-- Fix: rename the colliding alias to `eg`, changing nothing else — same
-- reservation predicate, same quota accounting, same audit row. The same fix
-- is applied to the checked-in source of both functions in
-- supabase/chartroom_waypoints.sql, which is what actually defines them for
-- a fresh install; this file exists to patch an environment that already
-- ran chartroom_waypoints.sql before this fix landed, without re-running it.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/fix_claim_gap_record_alias_collision.sql

create or replace function mcp_claim_gap_oauth(
  p_contributor_id bigint, p_gap_id bigint,
  p_claim_limits jsonb, p_ttl_days int, p_carta text
) returns jsonb
language plpgsql
as $$
declare a record; held int; g record; lim int; reserved record;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  perform pg_advisory_xact_lock(a.id);
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  update editorial_gaps
     set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select eg.requested_agent_account_id, aa.contributor_id
    into reserved
    from editorial_gaps eg
    left join agent_accounts aa on aa.id = eg.requested_agent_account_id
   where eg.id = p_gap_id;
  if not found then return jsonb_build_object('error', 'gap not found.'); end if;
  if reserved.requested_agent_account_id is not null and reserved.contributor_id is distinct from p_contributor_id then
    return jsonb_build_object('error', 'This Waypoint was offered to another Voyager.');
  end if;

  select count(*) into held from editorial_gaps
   where status = 'claimed'
     and (claimed_by_contributor_id = a.id or claimed_by = a.handle);
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active claim(s); the limit for rank ''%s'' is %s. Submit or let one expire first.',
      held, a.rank, lim));
  end if;

  update editorial_gaps g0
     set status = 'claimed', claimed_by = a.handle,
         claimed_by_contributor_id = a.id, claimed_at = now()
   where g0.id = p_gap_id
     and g0.status = 'open'
     and (
       g0.requested_agent_account_id is null
       or exists (
         select 1 from agent_accounts aa
          where aa.id = g0.requested_agent_account_id
            and aa.contributor_id = p_contributor_id
       )
     )
   returning g0.id, g0.title into g;
  if not found then
    return jsonb_build_object('error', 'gap not found, not open, or offered to another Voyager.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'mcp', 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('gap #%s ''%s'' claimed by %s', g.id, g.title, a.handle))),
               p_carta);

  return jsonb_build_object('claimed', jsonb_build_object('id', g.id, 'title', g.title));
end;
$$;

create or replace function mcp_claim_gap(
  p_handle text, p_key_hash text, p_gap_id bigint,
  p_claim_limits jsonb, p_ttl_days int, p_carta text
) returns jsonb
language plpgsql
as $$
declare a record; held int; g record; lim int; reserved record;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  perform pg_advisory_xact_lock(a.id);
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  update editorial_gaps
     set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select eg.requested_agent_account_id, aa.contributor_id, c.handle
    into reserved
    from editorial_gaps eg
    left join agent_accounts aa on aa.id = eg.requested_agent_account_id
    left join contributors c on c.id = aa.contributor_id
   where eg.id = p_gap_id;
  if not found then return jsonb_build_object('error', 'gap not found.'); end if;
  if reserved.requested_agent_account_id is not null and reserved.handle is distinct from p_handle then
    return jsonb_build_object('error', 'This Waypoint was offered to another Voyager.');
  end if;

  select count(*) into held from editorial_gaps
   where status = 'claimed'
     and (claimed_by_contributor_id = a.id or claimed_by = p_handle);
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active claim(s); the limit for rank ''%s'' is %s. Submit or let one expire first.',
      held, a.rank, lim));
  end if;

  update editorial_gaps g0
     set status = 'claimed', claimed_by = p_handle,
         claimed_by_contributor_id = a.id, claimed_at = now()
   where g0.id = p_gap_id
     and g0.status = 'open'
     and (
       g0.requested_agent_account_id is null
       or exists (
         select 1 from agent_accounts aa
          where aa.id = g0.requested_agent_account_id
            and aa.contributor_id = a.id
       )
     )
   returning g0.id, g0.title into g;
  if not found then
    return jsonb_build_object('error', 'gap not found, not open, or offered to another Voyager.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'mcp', 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('gap #%s ''%s'' claimed by %s', g.id, g.title, p_handle))),
               p_carta);

  return jsonb_build_object('claimed', jsonb_build_object('id', g.id, 'title', g.title));
end;
$$;
