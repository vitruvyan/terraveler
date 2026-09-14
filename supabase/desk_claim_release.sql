-- The editor can release a claimed Waypoint by hand, at any time, regardless
-- of the TTL. Until now the only way a claim reopened was reapStaleClaims()
-- (app/api/mcp/route.ts) or the equivalent SQL predicate inside
-- chartroom_take_waypoint / mcp_claim_gap[_oauth] (supabase/chartroom_waypoints.sql)
-- — and both only run lazily, as a side effect of someone else claiming or
-- listing gaps. A claim nobody happens to touch again just sits there past
-- its TTL with no automatic and no manual way to free it.
--
-- Apply after supabase/chartroom_waypoints.sql (editorial_gaps.claimed_by /
-- claimed_by_contributor_id / claimed_at must already exist).

begin;

create or replace function desk_release_claim(
  p_gap_id bigint, p_actor text, p_carta text
) returns jsonb
language plpgsql
as $$
declare g record; prior_holder text;
begin
  select id, title, claimed_by into g
    from editorial_gaps
   where id = p_gap_id and status = 'claimed'
   for update;
  if not found then
    return jsonb_build_object('error', 'This Waypoint is not currently claimed.');
  end if;
  prior_holder := g.claimed_by;

  update editorial_gaps
     set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
   where id = p_gap_id;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, p_actor, 'claim-released', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('Waypoint #%s ''%s'' released by the editor (was held by %s)',
                   g.id, g.title, coalesce(prior_holder, 'unknown')))),
               p_carta);

  return jsonb_build_object('released', jsonb_build_object('id', g.id, 'title', g.title));
end;
$$;

grant execute on function desk_release_claim(bigint, text, text) to terraveler_service;

commit;
