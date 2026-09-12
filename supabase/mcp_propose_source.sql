-- Phase 3A: Atomic Source Proposal and Intent Creation Function
-- Guarantees transactional atomicity for registering proposals and mapping intents,
-- preventing orphan proposal states and ensuring deduplication and security.

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
  p_original_target_url text
)
returns jsonb language plpgsql security definer as $$
declare
  v_host text;
  v_endpoint_id bigint;
  v_proposal_id bigint;
  v_is_new boolean := false;
begin
  -- Extract host pattern from canonical URL (safely normalized)
  v_host := lower(substring(p_canonical_url from '^(?:https?://)?([^:/]+)'));
  
  -- Check if an active endpoint matching this host pattern already exists
  select id into v_endpoint_id
  from source_endpoints
  where host_pattern = v_host and status = 'active'
  limit 1;
  
  -- Check for an existing pending proposal matching this canonical URL
  select id into v_proposal_id
  from source_proposals
  where target_url = p_canonical_url and status != 'resolved'
  limit 1;
  
  -- If no pending proposal, create one using the safe canonical public representation
  if v_proposal_id is null then
    v_is_new := true;
    insert into source_proposals (target_url, proposed_by_actor_type, proposed_by_actor_id, endpoint_id, status)
    values (p_canonical_url, p_proposed_by_actor_type, p_proposed_by_actor_id, v_endpoint_id, 'submitted')
    returning id into v_proposal_id;
  end if;
  
  -- Insert the structural intent record (guarantees no context loss)
  insert into source_proposal_intents (
    proposal_id, proposed_by_actor_type, proposed_by_actor_id,
    voyage, waypoint, region, person, reason, original_target_url
  ) values (
    v_proposal_id, p_proposed_by_actor_type, p_proposed_by_actor_id,
    p_voyage, p_waypoint, p_region, p_person, p_reason, p_original_target_url
  );
  
  return jsonb_build_object(
    'id', v_proposal_id,
    'is_new', v_is_new,
    'status', 'submitted'
  );
end $$;

-- Revoke execute from public/anon and grant only to the backend service
revoke execute on function mcp_propose_source from public, terraveler_anon;
grant execute on function mcp_propose_source to terraveler_service;
