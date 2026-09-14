-- mcp_propose_source gains two optional parameters: the agent's own
-- suggested trust_mode and rights_class, stored on the intent row it
-- already writes. See source_proposal_agent_classification.sql for why.
--
-- CREATE OR REPLACE with an added parameter creates a NEW overload
-- alongside the old one rather than replacing it -- Postgres keys a
-- function's identity on its parameter list, defaults included or not.
-- The old 10-arg signature is dropped explicitly first.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

drop function if exists public.mcp_propose_source(
  text, text, text, bigint, text, bigint, text, text, text, text);

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
returns jsonb language plpgsql security definer as $$
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

  select id into v_proposal_id
  from source_proposals
  where status != 'resolved' and (
    (v_endpoint_id is not null and endpoint_id = v_endpoint_id) or
    (v_endpoint_id is null and lower(substring(target_url from '^(?:https?://)?([^:/]+)')) = v_host)
  )
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

commit;
