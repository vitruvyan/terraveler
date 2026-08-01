-- Terraveler events outbox — the mycelium's first organ.
-- Run in psql AFTER audit_append_only.sql. Design: docs/SHIPS_OFFICERS.md
-- §5 (streams), §7 (contracts). Contracts: contracts/ in this repo.
--
-- The bus transports; it never interprets. Authority lives in this
-- database: audit_log is canonical, events are distribution. So events
-- are not written by application code at all — they are DERIVED, by
-- trigger, from the canonical writes themselves. That closes the
-- many-paths problem for good: web desk, RPC, Bearer fallback and Python
-- scripts all announce identically because none of them announces —
-- the ledger does. Owner enforcement (contracts: one emitter per event
-- type) comes free for the same reason: there is exactly one emitter,
-- and it is the transaction that recorded the fact.
--
-- A relay (future, VPS-side) copies unpublished rows to terraveler_redis
-- streams and stamps published_at. Until the relay exists this table
-- simply accumulates — which is correct: the outbox IS the durable
-- record; the stream is a projection of it and can be rebuilt from here.

create table if not exists events (
  id            bigint generated always as identity primary key,
  event_id      uuid not null default gen_random_uuid() unique,
  ts            timestamptz not null default now(),
  stream        text not null check (stream in ('editorial','crew','ops')),
  type          text not null,
  version       text not null default 'v1',
  actor         text not null,
  causation_id  bigint,             -- audit_log.id whose insert produced this
  carta_version text not null,
  payload       jsonb not null,
  published_at  timestamptz         -- stamped by the relay, nothing else
);

create index if not exists events_unpublished on events (id)
  where published_at is null;

-- The relay reads, and may stamp published_at — that column only. Events
-- are otherwise as immutable as the ledger they mirror.
grant select, insert on events to terraveler_service;
grant update (published_at) on events to terraveler_service;

create or replace function emit_event_from_audit()
returns trigger language plpgsql as $$
declare
  t text;
  s text := 'editorial';
begin
  -- The map from ledger rows to announcements. Actions not listed are
  -- ledger-only (key rotations, OAuth grants): recorded forever, not
  -- broadcast. An unknown action is therefore silence, not an error —
  -- the ledger must never fail because the bus lacks a word for it.
  if new.action = 'proposal' then
    t := 'idea.proposed';
  elsif new.action in ('suggestion', 'content-suggestion') then
    t := 'idea.proposed';
  elsif new.action = 'verdict' and new.actor = 'curator-gate' then
    t := case when new.verdict = 'reject'
              then 'gate.rejected' else 'draft.submitted' end;
  elsif new.action = 'verdict'
        and new.actor in ('editor-in-chief', 'curator-desk') then
    t := 'verdict.issued';
  elsif new.action = 'review' and new.actor = 'curator-desk' then
    t := 'escalation.raised';    -- the desk's "I cannot decide this alone"
  elsif new.action = 'review' then
    t := 'review.recorded';
  elsif new.action = 'peer-review-complete' then
    t := 'reviews.advanced';     -- what wakes the Curator
  elsif new.action = 'appeal' then
    t := 'appeal.filed';         -- straight to the editor; no officer rules
  elsif new.action = 'publish' then
    t := 'submission.published';
  elsif new.action = 'register' then
    t := 'contributor.registered'; s := 'crew';
  elsif new.action = 'crew-suspend' then
    t := 'contributor.suspended';  s := 'crew';
  elsif new.action = 'crew-reactivate' then
    t := 'contributor.reactivated'; s := 'crew';
  elsif new.action = 'crew-set-rank' then
    t := 'rank.changed';           s := 'crew';
  else
    return new;
  end if;

  insert into events (stream, type, actor, causation_id, carta_version, payload)
  values (s, t, new.actor, new.id, new.carta_version,
    jsonb_strip_nulls(jsonb_build_object(
      'submission_id', new.submission_id,
      'action',        new.action,
      'verdict',       new.verdict,
      'findings',      new.findings)));
  return new;
end $$;

drop trigger if exists audit_log_emits_events on audit_log;
create trigger audit_log_emits_events
  after insert on audit_log
  for each row execute function emit_event_from_audit();
