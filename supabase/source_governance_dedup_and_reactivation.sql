-- Source-governance remediation PR-6 (2026-09-24): two independent bugs in
-- the propose/resolve pair, found auditing what proposal #11 (Verrazzano +
-- an unrelated "Royal Geographical Society" search, fused into one
-- proposal) and the quarantined-endpoint approval path actually do.
--
-- NOTE ON PROVENANCE: this file is written against the definitions
-- REALLY installed on the production database as of 2026-09-24 (verified
-- with `select pg_get_functiondef(oid) from pg_proc where proname = ...`),
-- not against supabase/mcp_propose_source_classification.sql or
-- supabase/mcp_resolve_source_proposal.sql as checked into the repo at
-- this commit. Those two files are stale: the resolution-authority fix
-- (set search_path, collection_id guard, multi-intent guard, status =
-- 'submitted' dedup filter, 'approved'/'rejected' instead of 'resolved')
-- was applied directly to production but its branch
-- (fix/source-proposal-resolution-authority, commit 62c7ed0) was never
-- merged to main. This file's function bodies already include that
-- production state plus the two fixes below, so applying it is safe
-- regardless of whether that branch is merged first, but if it merges
-- AFTER this file, its own copies of these two functions will silently
-- revert both fixes below (they redefine the same functions without
-- either change). Whoever reconciles that branch needs to know this file
-- must win, or reapply on top of it.
--
-- 1. Dedup collapsed by endpoint, not by URL (mcp_propose_source). The
--    "is there already an open proposal for this?" check matched on
--    endpoint_id (or host, when no endpoint exists yet) -- so on an
--    aggregator domain like archive.org or wikisource.org, ANY new
--    proposal on that domain, any path, any agent, any reason, got
--    swallowed as an additional intent on whatever proposal happened to
--    be open first. That's the mechanism behind proposal #11. PR-2
--    (resolution-authority) already closed the dangerous half of this --
--    a verdict can no longer silently resolve more than one intent at
--    once -- but the fusion still happened at proposal time. This changes
--    the dedup match to the exact canonical URL: two proposals for
--    different paths on the same domain now stay separate proposals from
--    the start, even when the domain already has an active endpoint. Two
--    proposals for the literal same URL still merge as before (same
--    request, possibly different agents) -- that collapse is correct and
--    unchanged.
--
-- 2. UNIQUE violation on re-approving a non-active endpoint
--    (mcp_resolve_source_proposal). v_endpoint_id is resolved only among
--    status = 'active' endpoints. A quarantined/rejected/retired domain
--    resolves to null, so a proposal against it takes the "new endpoint"
--    branch -- which does a blind INSERT into source_endpoints. host_pattern
--    is UNIQUE, and the row already exists (just not active), so approving
--    such a proposal raised a raw constraint violation with no exception
--    handler: a 500 on the Desk, a message truncated at 190 characters on
--    Telegram. Fix: before inserting, look up ANY existing row for that
--    host_pattern regardless of status. If one exists, reactivate it
--    (status, trust_mode) instead of inserting a duplicate. Only insert
--    when truly no row exists for that host yet.
--
-- Both changes are additive redefinitions (CREATE OR REPLACE on the exact
-- installed signatures) -- no schema change, nothing to migrate. Verified
-- in a rollback-only transaction against the live database before this
-- file was ever committed for real; see PR-6 handoff notes for the runs.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

create or replace function mcp_propose_source(
  p_target_url text,
  p_canonical_url text,
  p_proposed_by_actor_type text,
  p_proposed_by_actor_id bigint,
  p_voyage text,
  p_waypoint bigint,
  p_region text,
  p_person text,
  p_reason text,
  p_original_target_url text,
  p_suggested_trust_mode text default null,
  p_suggested_rights_class text default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_host text;
  v_endpoint_id bigint;
  v_proposal_id bigint;
  v_is_new boolean := false;
begin
  v_host := lower(substring(p_canonical_url from '^(?:https?://)?([^:/]+)'));

  select id into v_endpoint_id
  from source_endpoints
  where match_type = 'exact' and host_pattern = v_host and status = 'active'
  limit 1;

  if v_endpoint_id is null then
    select id into v_endpoint_id
    from source_endpoints
    where match_type = 'suffix'
      and length(v_host) >= length(host_pattern)
      and right(v_host, length(host_pattern)) = host_pattern
      and status = 'active'
    limit 1;
  end if;

  -- Dedup on the exact canonical URL, not the endpoint/host -- see file
  -- header, fix 1. p_canonical_url already has its query string stripped
  -- by the caller (app/api/mcp/route.ts, suggest_source), so an exact
  -- match here really does mean "the same request."
  select id into v_proposal_id
  from source_proposals
  where status = 'submitted' and target_url = p_canonical_url
  limit 1;

  if v_proposal_id is null then
    v_is_new := true;
    insert into source_proposals (target_url, proposed_by_actor_type, proposed_by_actor_id, endpoint_id, status)
    values (p_canonical_url, p_proposed_by_actor_type, p_proposed_by_actor_id, v_endpoint_id, 'submitted')
    returning id into v_proposal_id;
  end if;

  insert into source_proposal_intents (
    proposal_id, proposed_by_actor_type, proposed_by_actor_id,
    voyage, waypoint, region, person, reason, original_target_url,
    suggested_trust_mode, suggested_rights_class
  ) values (
    v_proposal_id, p_proposed_by_actor_type, p_proposed_by_actor_id,
    p_voyage, p_waypoint, p_region, p_person, p_reason, p_original_target_url,
    p_suggested_trust_mode, p_suggested_rights_class
  );

  return jsonb_build_object(
    'id', v_proposal_id,
    'is_new', v_is_new,
    'status', 'submitted'
  );
end $$;

revoke execute on function mcp_propose_source from public, terraveler_anon;
grant execute on function mcp_propose_source to terraveler_service;

create or replace function mcp_resolve_source_proposal(
  p_proposal_id bigint,
  p_decision text,
  p_trust_mode text,
  p_rights_class text,
  p_reason text,
  p_decided_by_actor_type text,
  p_decided_by_actor_id bigint,
  p_carta_version text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_proposal record;
  v_host text;
  v_endpoint_id bigint;
  v_decision_id bigint;
  v_intent_count integer;
  v_final_status text;
begin
  if p_decision not in ('approve', 'reject') then
    return jsonb_build_object('error', 'decision must be approve or reject');
  end if;

  select * into v_proposal from source_proposals where id = p_proposal_id;
  if not found then
    return jsonb_build_object('error', 'proposal not found');
  end if;
  if v_proposal.status <> 'submitted' then
    return jsonb_build_object('error', format(
      'proposal #%s is %s, not submitted -- already resolved', p_proposal_id, v_proposal.status));
  end if;

  if v_proposal.collection_id is not null then
    return jsonb_build_object('error',
      'collection-based proposals are not yet supported by this function -- resolve via the endpoint path or extend mcp_resolve_source_proposal first');
  end if;

  select count(*) into v_intent_count
  from source_proposal_intents where proposal_id = p_proposal_id;
  if v_intent_count > 1 then
    return jsonb_build_object('error', format(
      'proposal #%s carries %s distinct intents -- a single verdict cannot resolve them together; per-intent resolution is not yet supported',
      p_proposal_id, v_intent_count));
  end if;

  v_final_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  if p_decision = 'approve' then
    if p_trust_mode is null then
      return jsonb_build_object('error', 'trust_mode is required to approve');
    end if;

    v_host := lower(substring(v_proposal.target_url from '^(?:https?://)?([^:/]+)'));
    if v_proposal.endpoint_id is not null then
      v_endpoint_id := v_proposal.endpoint_id;
      update source_endpoints set trust_mode = p_trust_mode, status = 'active'
       where id = v_endpoint_id;
    else
      -- See file header, fix 2. host_pattern is UNIQUE across ALL
      -- statuses, not just 'active' -- a quarantined/rejected/retired row
      -- for this host may already exist even though v_endpoint_id (scoped
      -- to status = 'active' above) came back null. Reactivate it instead
      -- of blind-inserting into a constraint that's already occupied.
      select id into v_endpoint_id
      from source_endpoints
      where host_pattern = v_host
      limit 1;

      if v_endpoint_id is not null then
        update source_endpoints set status = 'active', trust_mode = p_trust_mode
         where id = v_endpoint_id;
      else
        insert into source_endpoints (host_pattern, match_type, status, trust_mode)
        values (v_host, 'exact', 'active', p_trust_mode)
        returning id into v_endpoint_id;
      end if;
    end if;

    insert into source_policy_decisions
      (endpoint_id, decision_outcome, trust_mode, rights_class, evidence_snapshot,
       policy_version, verification_version, carta_version, decided_by_actor_type,
       decided_by_actor_id, reason)
    values
      (v_endpoint_id, 'approve', p_trust_mode, p_rights_class,
       jsonb_build_object('proposal_id', p_proposal_id, 'target_url', v_proposal.target_url),
       'human-v1', 'human-v1', p_carta_version, p_decided_by_actor_type, p_decided_by_actor_id, p_reason)
    returning id into v_decision_id;

    update source_proposals set status = 'approved', endpoint_id = v_endpoint_id
     where id = p_proposal_id;
  else
    insert into source_policy_decisions
      (proposal_id, decision_outcome, trust_mode, rights_class, evidence_snapshot,
       policy_version, verification_version, carta_version, decided_by_actor_type,
       decided_by_actor_id, reason)
    values
      (p_proposal_id, 'reject', null, p_rights_class,
       jsonb_build_object('proposal_id', p_proposal_id, 'target_url', v_proposal.target_url),
       'human-v1', 'human-v1', p_carta_version, p_decided_by_actor_type, p_decided_by_actor_id, p_reason)
    returning id into v_decision_id;

    update source_proposals set status = 'rejected' where id = p_proposal_id;
  end if;

  return jsonb_build_object(
    'decision_id', v_decision_id, 'proposal_id', p_proposal_id,
    'endpoint_id', v_endpoint_id, 'status', v_final_status);
end $$;

revoke execute on function mcp_resolve_source_proposal from public, terraveler_anon;
grant execute on function mcp_resolve_source_proposal to terraveler_service;

commit;
