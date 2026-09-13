-- Negative-standing signal, part 1: claim abandonment (Phase 5).
--
-- Both claim RPCs reap stale claims inline (Carta: claims expire after
-- p_ttl_days unworked) with a blind UPDATE that has always discarded who
-- held the claim in the same statement that forgets it. There was no way to
-- answer "does this contributor have a pattern of taking work and not doing
-- it" because the fact was never recorded anywhere -- not a missing query,
-- a missing write.
--
-- Recorded the same way an appeal already is: actor = 'contributor:<handle>',
-- so scripts/desk_graph.py's read_dossier can count it with a plain equality
-- match against contributors.handle, no parsing of `findings` prose.
--
-- One statement, not two round trips: a SELECT...FOR UPDATE feeds both the
-- reaping UPDATE and the audit INSERT, so a claim can never be reaped
-- without also being recorded, or vice versa -- the two facts commit
-- together or not at all, in the same transaction pg_advisory_xact_lock(a.id)
-- already covers.
--
-- Two CTEs, not one, and the reason is worth stating because it looks like
-- needless caution: `UPDATE ... SET claimed_by = null ... RETURNING
-- claimed_by` returns the NEW value -- null, always -- not the value being
-- overwritten. A first version of this migration returned exactly that:
-- every reap fired, every claim correctly reopened, and not one abandonment
-- was ever recorded, silently, because the row this file's own INSERT read
-- from was already the post-UPDATE row. Caught by running it against the
-- real database and checking audit_log directly rather than trusting that
-- an UPDATE returning the row it just changed said "changed" and "reopened"
-- prove the value the migration's whole purpose is to capture is still
-- there. `stale` below is deliberately a plain SELECT, locked but never
-- written, that reads claimed_by before anything touches it.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

create or replace function public.mcp_claim_gap_oauth(
  p_contributor_id bigint, p_gap_id bigint, p_claim_limits jsonb,
  p_ttl_days integer, p_carta text
)
returns jsonb language plpgsql as $$
declare a record; held int; g record; lim int; reserved record;
begin
  select * into a from mcp_contributor(p_contributor_id);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  perform pg_advisory_xact_lock(a.id);
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  with stale as (
    select id, title, claimed_by from editorial_gaps
     where status = 'claimed'
       and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days))
     for update
  ),
  reaped as (
    update editorial_gaps eg
       set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
      from stale
     where eg.id = stale.id
    returning eg.id
  )
  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
  select null, 'contributor:' || stale.claimed_by, 'claim-abandoned', null,
         jsonb_build_array(jsonb_build_array('INFO', 0,
           format('gap #%s ''%s'' expired unworked (%s-day TTL) and reopened', stale.id, stale.title, p_ttl_days))),
         p_carta
    from stale join reaped on reaped.id = stale.id
   where stale.claimed_by is not null;

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

create or replace function public.mcp_claim_gap(
  p_handle text, p_key_hash text, p_gap_id bigint, p_claim_limits jsonb,
  p_ttl_days integer, p_carta text
)
returns jsonb language plpgsql as $$
declare a record; held int; g record; lim int; reserved record;
begin
  select * into a from mcp_auth(p_handle, p_key_hash);
  if a.err is not null then return jsonb_build_object('error', a.err); end if;

  perform pg_advisory_xact_lock(a.id);
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  with stale as (
    select id, title, claimed_by from editorial_gaps
     where status = 'claimed'
       and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days))
     for update
  ),
  reaped as (
    update editorial_gaps eg
       set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
      from stale
     where eg.id = stale.id
    returning eg.id
  )
  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
  select null, 'contributor:' || stale.claimed_by, 'claim-abandoned', null,
         jsonb_build_array(jsonb_build_array('INFO', 0,
           format('gap #%s ''%s'' expired unworked (%s-day TTL) and reopened', stale.id, stale.title, p_ttl_days))),
         p_carta
    from stale join reaped on reaped.id = stale.id
   where stale.claimed_by is not null;

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

commit;
