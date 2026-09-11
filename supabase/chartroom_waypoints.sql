-- The Chartroom: additive adapter over the existing editorial backlog.
--
-- Apply after governance_schema.sql, oauth.sql and agent_identity.sql.
-- This deliberately does NOT rename or replace editorial_gaps: MCP 2025/2026
-- clients keep using list_gaps / claim_gap while the web calls the same rows
-- Waypoints. Rollback is limited to dropping the view, columns and follow table.

begin;

alter table editorial_gaps
  add column if not exists waypoint_type text,
  add column if not exists claimed_by_contributor_id bigint references contributors(id);

alter table editorial_gaps
  drop constraint if exists editorial_gaps_waypoint_type_check;
alter table editorial_gaps
  add constraint editorial_gaps_waypoint_type_check check (
    waypoint_type is null or waypoint_type in (
      'source','image','map','claim','transcription','translation',
      'narrative','review','challenge'
    )
  );

update editorial_gaps
set waypoint_type = case kind
  when 'voyage' then 'narrative'
  when 'waypoint' then 'claim'
  when 'media' then 'image'
  when 'perspective' then 'challenge'
  when 'translation' then 'translation'
  when 'correction' then 'review'
  else 'claim'
end
where waypoint_type is null;

update editorial_gaps g
set claimed_by_contributor_id = c.id
from contributors c
where g.claimed_by_contributor_id is null
  and g.claimed_by = c.handle;

create table if not exists chartroom_follows (
  contributor_id bigint not null references contributors(id) on delete cascade,
  editorial_gap_id bigint not null references editorial_gaps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contributor_id, editorial_gap_id)
);

comment on table chartroom_follows is
  'Actor-agnostic subscriptions to shared Chartroom work. contributor_id may '
  'belong to a human or an agent; association between them grants nothing.';

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
  g.status as legacy_status
from editorial_gaps g
left join contributors c on c.handle = g.claimed_by;

comment on view chartroom_waypoints is
  'Compatibility projection: one shared Waypoint backlog for human web actors '
  'and agent MCP actors, backed by editorial_gaps during incremental rollout.';

-- Actor-agnostic, atomic take operation for the web workspace. Existing MCP
-- functions remain unchanged so both 2025 and 2026 clients keep their contract.
create or replace function chartroom_take_waypoint(
  p_contributor_id bigint,
  p_waypoint_id bigint,
  p_claim_limits jsonb,
  p_ttl_days int,
  p_carta text,
  p_actor text
) returns jsonb
language plpgsql
as $$
declare c record; held int; w record; lim int;
begin
  select id, handle, rank, status into c
    from contributors where id = p_contributor_id;
  if not found then
    return jsonb_build_object('error', 'This account has no contributor identity.');
  elsif c.status <> 'active' then
    return jsonb_build_object('error', 'This contributor is suspended.');
  end if;

  -- Serialize quota checks for one standing-bearing contributor while the row
  -- update below arbitrates competing actors taking the same Waypoint.
  perform pg_advisory_xact_lock(p_contributor_id);
  lim := coalesce(
    (p_claim_limits ->> c.rank)::int,
    (p_claim_limits ->> 'cabin-boy')::int
  );

  update editorial_gaps
     set status = 'open', claimed_by = null, claimed_by_contributor_id = null,
         claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select count(*) into held from editorial_gaps
   where coalesce(claimed_by_contributor_id = c.id, claimed_by = c.handle)
     and status = 'claimed';
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active Waypoint(s); the limit for rank ''%s'' is %s.',
      held, c.rank, lim));
  end if;

  update editorial_gaps
     set status = 'claimed', claimed_by = c.handle,
         claimed_by_contributor_id = c.id, claimed_at = now()
   where id = p_waypoint_id and status = 'open'
   returning id, title into w;
  if not found then
    return jsonb_build_object('error', 'This Waypoint is no longer open.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, p_actor, 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('Waypoint #%s ''%s'' taken by %s', w.id, w.title, c.handle))),
               p_carta);

  return jsonb_build_object('taken', jsonb_build_object('id', w.id, 'title', w.title));
end;
$$;

grant select on chartroom_waypoints to terraveler_anon, terraveler_service;
grant select, insert, delete on chartroom_follows to terraveler_service;
grant execute on function chartroom_take_waypoint(bigint, bigint, jsonb, int, text, text)
  to terraveler_service;

commit;
