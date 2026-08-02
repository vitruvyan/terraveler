-- Terraveler events — dead letters go through the ledger.
-- Run in psql AFTER events_outbox.sql (CREATE OR REPLACE of its trigger fn).
--
-- The first dispatcher draft INSERTed dlq.entry rows into events directly,
-- which events_outbox.sql forbids in as many words: application code never
-- writes events, the ledger announces. The adversarial review caught the
-- contradiction. So the fact recorded is the failure itself: the
-- dispatcher writes audit_log (actor 'dispatcher', action 'dead-letter',
-- findings = the canonical DLQEntry object), and this mapping derives the
-- dlq.entry event from that row — same one road onto the wire as every
-- other announcement, protected by the same append-only triggers.
--
-- One special case in the payload: for 'dead-letter' the findings ARE the
-- contract payload (contracts/events/dlq.entry.v1.json), so they pass
-- through whole instead of being wrapped in the generic projection.

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
    -- Exactly the gate's two words (app/api/mcp/route.ts): anything else
    -- from this actor is a vocabulary change and stays silent until mapped.
    if new.verdict = 'reject' then t := 'gate.rejected';
    elsif new.verdict = 'pass-gate' then t := 'draft.submitted';
    else return new;
    end if;
  elsif new.action = 'verdict'
        and new.actor in ('editor-in-chief', 'curator-desk', 'curator-v0') then
    -- curator-v0 is the retired CLI (scripts/curator.py); if it ever rules
    -- again, its verdict changed state and must announce like any other.
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
  elsif new.action = 'dead-letter' then
    t := 'dlq.entry';            s := 'ops';
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
    case when new.action = 'dead-letter'
         then coalesce(new.findings, '{}'::jsonb)
         else jsonb_strip_nulls(jsonb_build_object(
                'submission_id', new.submission_id,
                'action',        new.action,
                'verdict',       new.verdict,
                'findings',      new.findings))
    end);
  return new;
end $$;
