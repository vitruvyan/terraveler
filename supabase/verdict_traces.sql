-- The evidence that a verdict was not edited afterwards.
--
-- Carta §2 gives the Curator the power to rule and §5 makes every verdict
-- motivated, cited and appealable. All three were built. What was not built is
-- the part that makes them worth anything to someone who does not trust us: a
-- verdict lived in `audit_log`, `audit_log` is a table, and a table can be
-- edited by whoever holds the password. The row would still say
-- "changes-requested", still carry its findings, still name the Curator — and
-- say something the pass never concluded.
--
-- So the pass runs on Motus (scripts/desk_graph.py) and leaves an immutable
-- trace: every read, every decision, every routing, hash-chained record by
-- record, with a root over the whole run. This table holds it beside the
-- submission it ruled on, and `scripts/anchor.py` publishes the root on a
-- public chain. Editing the verdict afterwards is still possible; editing it
-- without the edit becoming visible is not.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/verdict_traces.sql
--
-- WHY trace_jsonl IS text AND NOT jsonb
-- ------------------------------------
-- Not for the reason first written here. That reason was that jsonb reorders
-- keys and re-serialises, so a trace stored in it would be checked against
-- bytes Postgres chose rather than the ones Motus wrote, and would fail
-- validation without anyone having tampered with it. That is false, and it was
-- measured on this deployment rather than argued: `chat_traces.trace` IS
-- jsonb, a trace read back out of it validates at zero violations, the same
-- document with every object's keys reversed also validates, and the same
-- document with one routing value altered is refused under T11. Motus hashes a
-- canonical form; key order does not reach the digest.
--
-- What text buys is directness. The column holds the exact JSONL stream the
-- shipped validator reads in its `jsonl` mode, so checking a verdict is one
-- psql redirect and nothing else — no re-rendering a document into the stream
-- form first, and so no question of whether the re-rendering was faithful.
-- The stored artifact IS the evidence rather than a projection of it:
--
--   psql -tAc "select trace_jsonl from verdict_traces where id = 1" > t.jsonl
--   motus-validate jsonl t.jsonl        # exit 0, and anyone can run it
--
-- `root` gets its own column because it is the one value published on chain,
-- and something published deserves to be selectable rather than parsed back
-- out of a document. It is unique where present: two runs cannot honestly
-- produce the same root, and a run that never reached its terminal has none —
-- which is why the index is partial rather than a NOT NULL column.

create table if not exists verdict_traces (
  id             bigint generated always as identity primary key,
  submission_id  bigint references submissions(id),
  run_id         text not null,
  verdict        text,
  root           text,
  -- Motus's own report on whether the durable evidence for the run is whole
  -- (persisted | incomplete | not-required). A trace that says `incomplete` is
  -- an honest prefix, and saying so is better than storing it as if it were a
  -- whole one.
  evidence       text,
  status         text,
  schema_version text,
  trace_jsonl    text not null,
  created_at     timestamptz not null default now(),
  -- The anchor (scripts/anchor.py). Null until the root is published: a trace
  -- is complete evidence on its own terms, and the chain adds one thing to it
  -- — that the root existed before anyone could have edited the row.
  anchor_txid    text,
  anchor_receipt jsonb,
  anchored_at    timestamptz
);

-- Stated as ALTERs as well, because the table already exists in production and
-- this file has to be safe to re-run. Same three columns; one source.
alter table verdict_traces
  add column if not exists anchor_txid    text,
  add column if not exists anchor_receipt jsonb,
  add column if not exists anchored_at    timestamptz;

create unique index if not exists verdict_traces_txid
  on verdict_traces (anchor_txid) where anchor_txid is not null;

create index if not exists verdict_traces_submission
  on verdict_traces (submission_id, id desc);

create unique index if not exists verdict_traces_root
  on verdict_traces (root) where root is not null;

comment on table verdict_traces is
  'One immutable Motus trace per Curator verdict, in the canonical JSONL form '
  'the shipped validator accepts. `root` is the hash over the whole run and is '
  'the only value published on chain (scripts/anchor.py).';
