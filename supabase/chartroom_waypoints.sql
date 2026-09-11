-- The Chartroom: additive adapter over the existing editorial backlog.
--
-- Apply to the Terraveler PostgreSQL database on the VPS after:
--   governance_schema.sql
--   governance_hardening.sql
--   oauth.sql
--   agent_identity.sql
--   mcp_write_functions.sql
--   mcp_oauth_write_functions.sql
--
-- This deliberately does NOT rename or replace editorial_gaps: MCP 2025/2026
-- clients keep using list_gaps / claim_gap while the web calls the same rows
-- Waypoints. The contextual columns below let an Atlas stop and The Chartroom
-- point at the same work item instead of maintaining two contribution systems.

begin;

alter table editorial_gaps
  add column if not exists waypoint_type text,
  add column if not exists claimed_by_contributor_id bigint references contributors(id),
  add column if not exists context_type text,
  add column if not exists context_voyage text,
  add column if not exists context_waypoint_seq int,
  add column if not exists context_place text,
  add column if not exists created_by_contributor_id bigint references contributors(id),
  add column if not exists initiated_by_contributor_id bigint references contributors(id),
  add column if not exists requested_agent_account_id bigint references agent_accounts(id);

alter table editorial_gaps
  drop constraint if exists editorial_gaps_waypoint_type_check;
alter table editorial_gaps
  add constraint editorial_gaps_waypoint_type_check check (
    waypoint_type is null or waypoint_type in (
      'source','image','map','claim','transcription','translation',
      'narrative','review','challenge'
    )
  );

alter table editorial_gaps
  drop constraint if exists editorial_gaps_context_type_check;
alter table editorial_gaps
  add constraint editorial_gaps_context_type_check check (
    context_type is null or context_type in ('atlas','voyage','voyage_waypoint')
  );

alter table editorial_gaps
  drop constraint if exists editorial_gaps_context_waypoint_seq_check;
alter table editorial_gaps
  add constraint editorial_gaps_context_waypoint_seq_check check (
    context_waypoint_seq is null or context_waypoint_seq > 0
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

create index if not exists editorial_gaps_chartroom_context_idx
  on editorial_gaps (context_voyage, context_waypoint_seq, status)
  where context_voyage is not null;

create index if not exists editorial_gaps_requested_agent_idx
  on editorial_gaps (requested_agent_account_id, status)
  where requested_agent_account_id is not null;

create table if not exists chartroom_follows (
  contributor_id bigint not null references contributors(id) on delete cascade,
  editorial_gap_id bigint not null references editorial_gaps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contributor_id, editorial_gap_id)
);

comment on table chartroom_follows is
  'Actor-agnostic subscriptions to shared Chartroom work. contributor_id may '
  'belong to a human or an agent; association between them grants nothing.';

comment on column editorial_gaps.context_voyage is
  'Optional Atlas voyage slug. Together with context_waypoint_seq this is the stable seam between contextual Contribute and the global Chartroom.';
comment on column editorial_gaps.initiated_by_contributor_id is
  'The contributor who initiated this work request. It is provenance only and never receives the performer''s standing.';
comment on column editorial_gaps.requested_agent_account_id is
  'Optional Voyager to whom an open Waypoint was offered. The work remains open until that independent agent claims it through MCP.';

-- Preserve the original compatibility-view prefix exactly. PostgreSQL permits
-- CREATE OR REPLACE VIEW to append columns but not to rename/reorder existing
-- ones. This makes the migration safely re-runnable even on a preview database
-- that saw an earlier Chartroom draft.
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
  -- New columns are appended after the original view contract.
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
  rc.handle as requested_agent_handle
from editorial_gaps g
left join contributors c on c.handle = g.claimed_by
left join agent_accounts ra on ra.id = g.requested_agent_account_id
left join contributors rc on rc.id = ra.contributor_id;

comment on view chartroom_waypoints is
  'Compatibility projection: one shared Waypoint backlog for human web actors '
  'and agent MCP actors, backed by editorial_gaps during incremental rollout.';

-- Actor-agnostic, atomic take operation for the web workspace. Existing MCP
-- functions remain named as before so both 2025 and 2026 clients keep their
-- contract. A Waypoint offered to a Voyager cannot be taken from the web while
-- that offer is active; the requested agent must claim it through MCP.
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
declare c record; held int; w record; lim int; requested bigint;
begin
  select id, handle, rank, status into c
    from contributors where id = p_contributor_id;
  if not found then
    return jsonb_build_object('error', 'This account has no contributor identity.');
  elsif c.status <> 'active' then
    return jsonb_build_object('error', 'This contributor is suspended.');
  end if;

  select requested_agent_account_id into requested
    from editorial_gaps where id = p_waypoint_id;
  if not found then
    return jsonb_build_object('error', 'This Waypoint does not exist.');
  elsif requested is not null then
    return jsonb_build_object('error', 'This Waypoint has been offered to a Voyager. That independent agent must claim it through MCP.');
  end if;

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
   where status = 'claimed'
     and (claimed_by_contributor_id = c.id or claimed_by = c.handle);
  if held >= lim then
    return jsonb_build_object('error', format(
      'You hold %s active Waypoint(s); the limit for rank ''%s'' is %s.',
      held, c.rank, lim));
  end if;

  -- Reservation is part of the UPDATE predicate, not only the earlier read.
  -- PostgreSQL re-checks this predicate after waiting on a concurrent row
  -- update, so a human take cannot race a Voyager offer and steal the work.
  update editorial_gaps
     set status = 'claimed', claimed_by = c.handle,
         claimed_by_contributor_id = c.id, claimed_at = now()
   where id = p_waypoint_id
     and status = 'open'
     and requested_agent_account_id is null
   returning id, title into w;
  if not found then
    return jsonb_build_object('error', 'This Waypoint is no longer open or has been offered to a Voyager.');
  end if;

  insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
       values (null, p_actor, 'claim-gap', null,
               jsonb_build_array(jsonb_build_array('INFO', 0,
                 format('Waypoint #%s ''%s'' taken by %s', w.id, w.title, c.handle))),
               p_carta);

  return jsonb_build_object('taken', jsonb_build_object('id', w.id, 'title', w.title));
end;
$$;

-- Human -> Voyager is an offer, not identity transfer and not publication
-- authority. The human contributor must belong to the same authenticated human
-- principal that owns the association used to address the Voyager.
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

  -- First offer wins. A later request cannot silently replace the initiator or
  -- retarget work already addressed to another (or the same) independent agent.
  update editorial_gaps
     set requested_agent_account_id = p_agent_account_id,
         initiated_by_contributor_id = p_human_contributor_id
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

-- MCP 2025 compatibility claim. If a human has offered a Waypoint to a
-- particular Voyager, the legacy handle must be the contributor attached to
-- that agent account. Otherwise the legacy semantics are unchanged.
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

  -- Serialize quota accounting for one standing-bearing contributor. Without
  -- this, two concurrent claim requests could both count the same free slot.
  perform pg_advisory_xact_lock(a.id);
  lim := coalesce((p_claim_limits ->> a.rank)::int, (p_claim_limits ->> 'cabin-boy')::int);

  update editorial_gaps
     set status = 'open', claimed_by = null, claimed_by_contributor_id = null, claimed_at = null
   where status = 'claimed'
     and (claimed_at is null or claimed_at < now() - make_interval(days => p_ttl_days));

  select g.requested_agent_account_id, aa.contributor_id, c.handle
    into reserved
    from editorial_gaps g
    left join agent_accounts aa on aa.id = g.requested_agent_account_id
    left join contributors c on c.id = aa.contributor_id
   where g.id = p_gap_id;
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

  -- The reservation condition is repeated atomically here. A stale pre-check
  -- must never let the wrong agent win a race with chartroom_offer_waypoint.
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

-- Modern OAuth claim keeps the same tool/protocol contract. Reservation is
-- checked against the durable agent account's contributor, never model/runtime.
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

  select g.requested_agent_account_id, aa.contributor_id
    into reserved
    from editorial_gaps g
    left join agent_accounts aa on aa.id = g.requested_agent_account_id
   where g.id = p_gap_id;
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

grant select on chartroom_waypoints to terraveler_anon, terraveler_service;
grant select, insert, delete on chartroom_follows to terraveler_service;
grant execute on function chartroom_take_waypoint(bigint, bigint, jsonb, int, text, text)
  to terraveler_service;
grant execute on function chartroom_offer_waypoint(bigint, bigint, bigint, bigint, text)
  to terraveler_service;
grant execute on function mcp_claim_gap(text, text, bigint, jsonb, int, text)
  to terraveler_service;
grant execute on function mcp_claim_gap_oauth(bigint, bigint, jsonb, int, text)
  to terraveler_service;

commit;
