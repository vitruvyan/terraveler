-- Phase 3A/human-review: resolve a submitted source proposal.
--
-- mcp_propose_source (Phase 3A) is the intake — an agent or human names a
-- domain, and the row sits at status='submitted'. Nothing moved it forward:
-- the Archivist investigation stage the original design named was never
-- built, and neither was any human-facing review surface, so five real
-- proposals sat invisible until this was noticed. This is the minimal
-- counterpart intake needed: a human editor's direct verdict, not the
-- automated investigation pipeline (a separate, larger piece of future
-- work) — approve with a trust_mode and rights_class, or reject with a
-- reason. Both write one append-only source_policy_decisions row
-- (source_governance_immutability.sql already forbids UPDATE/DELETE on it)
-- and resolve the proposal so it leaves the pending queue.
--
-- Source-governance remediation PR-2 (2026-09-24) closes two authority gaps
-- found in this function and hardens it to match its siblings:
--
-- 1. Multi-intent blindness. A proposal can carry more than one
--    source_proposal_intents row (propose_source_additional attaches a new
--    intent to an existing pending proposal, app/api/mcp/route.ts). This
--    function used to resolve the whole proposal on one verdict regardless
--    of how many intents it held -- a real case (proposal #11) had an
--    approved archive.org item intent silently carry a second, never-seen
--    "Royal Geographical Society" search intent along with it. Now: more
--    than one intent blocks resolution outright, for approve AND reject
--    alike (a reject could just as wrongly sink a valid intent bundled with
--    a bad one). Per-intent resolution is a separate, larger frontend/UX
--    piece of future work -- this only refuses the ambiguity.
-- 2. collection_id was read (select *) but never checked. A proposal aimed
--    at a source_collections row would fall through to the endpoint-only
--    branch below and approve/create the wrong thing. Now rejected
--    explicitly; the collection path isn't implemented (nothing exercises
--    it yet -- source_collections is empty).
--
-- It also gains set search_path, matching quarantine_source_subject and
-- apply_source_policy_decision (both already SECURITY DEFINER + search_path
-- guarded) -- this one and mcp_propose_source were the two SECURITY DEFINER
-- functions in this area still missing it.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

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
      insert into source_endpoints (host_pattern, match_type, status, trust_mode)
      values (v_host, 'exact', 'active', p_trust_mode)
      returning id into v_endpoint_id;
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
