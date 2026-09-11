-- The Chartroom: release a Voyager offer without deleting the Waypoint.
--
-- Apply AFTER supabase/chartroom_waypoints.sql. This is additive and keeps the
-- existing MCP 2025/2026 claim signatures unchanged.

begin;

alter table editorial_gaps
  add column if not exists requested_agent_offered_by_contributor_id bigint references contributors(id),
  add column if not exists requested_agent_offered_at timestamptz;

-- Preview databases may already contain offers created by the first Chartroom
-- migration. Preserve their ownership so the initiating human can release them.
update editorial_gaps
   set requested_agent_offered_by_contributor_id = initiated_by_contributor_id,
       requested_agent_offered_at = coalesce(requested_agent_offered_at, created_at)
 where requested_agent_account_id is not null
   and requested_agent_offered_by_contributor_id is null;

create index if not exists editorial_gaps_offer_owner_idx
  on editorial_gaps (requested_agent_offered_by_contributor_id, status)
  where requested_agent_account_id is not null;

comment on column editorial_gaps.requested_agent_offered_by_contributor_id is
  'Human contributor who addressed the current Voyager offer. This controls release authority; it does not own the agent or receive agent standing.';
comment on column editorial_gaps.requested_agent_offered_at is
  'When the current Voyager offer was created. Kept separately from Waypoint creation/claim timestamps.';

-- Preserve the exact existing view prefix and append the release metadata.
create or replace view chartroom_waypoints as
select
  g.id,
  g.title,
  g.description,
  coalesce(g.waypoint_type, case g.kind
    when 'voyage' then 'narrative'
    when 'waypoint' then 'claim'
    when 'media' then 'image'
    when 'perspective' then 'challenge'
    when 'translation' then 'translation'
    when 'correction' then 'review'
    else 'claim'
  end) as type,
  g.priority,
  case g.status
    when 'open' then 'open'
    when 'claimed' then 'taken'
    when 'done' then 'accepted'
  end as status,
  coalesce(g.claimed_by_contributor_id, c.id) as taken_by_contributor_id,
  g.claimed_at as taken_at,
  g.created_at,
  g.kind as legacy_kind,
  g.status as legacy_status,
  coalesce(c.handle, g.claimed_by) as taken_by_handle,
  g.context_type,
  g.context_voyage,
  g.context_waypoint_seq,
  g.context_place,
  g.created_by_contributor_id,
  g.initiated_by_contributor_id,
  g.requested_agent_account_id,
  ra.public_id as requested_agent_id,
  coalesce(ra.display_name, rc.handle) as requested_agent_name,
  rc.handle as requested_agent_handle,
  g.requested_agent_offered_by_contributor_id,
  g.requested_agent_offered_at
from editorial_gaps g
left join contributors c on c.handle = g.claimed_by
left join agent_accounts ra on ra.id = g.requested_agent_account_id
left join contributors rc on rc.id = ra.contributor_id;

-- Replace the offer function with the same signature. The Waypoint's original
-- initiator is preserved; the current offer gets its own explicit provenance.
create or replace function chartroom_offer_waypoint(
  p_human_principal_id bigint,
  p_human_contributor_id bigint,
  p_agent_account_id bigint,
  p_waypoint_id bigint,
  p_carta text
) returns jsonb
language plpgsql
as $$
declare h record; aa record; ac record; w record;
begin
  select id, handle, status into h
    from contributors
   where id = p_human_contributor_id
     and human_principal_id = p_human_principal_id;
  if not found or h.status <> 'active' then
    return jsonb_build_object('error', 'The initiating human contributor is not active or does not belong to this account.');
  end if;

  if not exists (
    select 1 from human_agent_links
     where human_principal_id = p_human_principal_id
       and agent_account_id = p_agent_account_id
       and relation = 'associated'
       and revoked_at is null
  ) then
    return jsonb_build_object('error', 'That Voyager is not associated with this human account.');
  end if;

  select id, public_id, display_name, contributor_id, status into aa
    from agent_accounts where id = p_agent_account_id;
  if not found or aa.status <> 'active' then
    return jsonb_build_object('error', 'That Voyager is not active.');
  end if;

  select id, handle, rank, status into ac from contributors where id = aa.contributor_id;
  if not found or ac.status <> 'active' then
    return jsonb_build_object('error', 'That Voyager contributor is not active.');
  end if;

  update editorial_gaps
     set requested_agent_account_id = p_agent_account_id,
         requested_agent_offered_by_contributor_id = p_human_contributor_id,
         requested_agent_offered_at = now(),
         initiated_by_contributor_id = coalesce(initiated_by_contributor_id, p_human_contributor_id)
   where id = p_waypoint_id
     and status = 'open'
     and requested_agent_account_id is null
   returning id, title into w;
  if not found then
    return jsonb_build_object('error', 'This Waypoint is no longer open or has already been offered to a Voyager.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'contributor:' || h.handle, 'offer-waypoint', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('Waypoint #%s ''%s'' offered by %s to Voyager %s (%s)',
                   w.id, w.title, h.handle, coalesce(aa.display_name, ac.handle), aa.public_id))),
               p_carta);

  return jsonb_build_object(
    'offered', jsonb_build_object(
      'id', w.id,
      'title', w.title,
      'agent_account_id', aa.id,
      'agent_id', aa.public_id,
      'agent_name', coalesce(aa.display_name, ac.handle),
      'agent_handle', ac.handle
    )
  );
end;
$$;

-- Only the human contributor who made the current offer can release it. The
-- Waypoint remains open and immediately returns to the common pool. If the
-- Voyager has already claimed it, release is refused rather than stealing work
-- back from an independent contributor.
create or replace function chartroom_release_waypoint_offer(
  p_human_principal_id bigint,
  p_human_contributor_id bigint,
  p_waypoint_id bigint,
  p_carta text
) returns jsonb
language plpgsql
as $$
declare h record; w record; aa record; ac record;
begin
  select id, handle, status into h
    from contributors
   where id = p_human_contributor_id
     and human_principal_id = p_human_principal_id;
  if not found or h.status <> 'active' then
    return jsonb_build_object('error', 'This human contributor is not active or does not belong to this account.');
  end if;

  select id, title, requested_agent_account_id, requested_agent_offered_by_contributor_id
    into w
    from editorial_gaps
   where id = p_waypoint_id
     and status = 'open'
     and requested_agent_account_id is not null
   for update;
  if not found then
    return jsonb_build_object('error', 'This Waypoint has no releasable Voyager offer. It may already have been claimed.');
  end if;
  if w.requested_agent_offered_by_contributor_id is distinct from p_human_contributor_id then
    return jsonb_build_object('error', 'Only the human contributor who made this offer can release it.');
  end if;

  select id, public_id, display_name, contributor_id into aa
    from agent_accounts where id = w.requested_agent_account_id;
  if aa.contributor_id is not null then
    select id, handle into ac from contributors where id = aa.contributor_id;
  end if;

  update editorial_gaps
     set requested_agent_account_id = null,
         requested_agent_offered_by_contributor_id = null,
         requested_agent_offered_at = null
   where id = p_waypoint_id
     and status = 'open'
     and requested_agent_account_id = w.requested_agent_account_id
     and requested_agent_offered_by_contributor_id = p_human_contributor_id;
  if not found then
    return jsonb_build_object('error', 'The offer changed before it could be released.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, 'contributor:' || h.handle, 'release-waypoint-offer', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('Waypoint #%s ''%s'' released from Voyager %s (%s)',
                   w.id, w.title, coalesce(aa.display_name, ac.handle, 'Voyager'), coalesce(aa.public_id, 'unknown')))),
               p_carta);

  return jsonb_build_object(
    'released', jsonb_build_object(
      'id', w.id,
      'title', w.title,
      'agent_id', aa.public_id,
      'agent_name', coalesce(aa.display_name, ac.handle, 'Voyager'),
      'agent_handle', ac.handle
    )
  );
end;
$$;

grant select on chartroom_waypoints to terraveler_anon, terraveler_service;
grant execute on function chartroom_offer_waypoint(bigint, bigint, bigint, bigint, text)
  to terraveler_service;
grant execute on function chartroom_release_waypoint_offer(bigint, bigint, bigint, text)
  to terraveler_service;

commit;
