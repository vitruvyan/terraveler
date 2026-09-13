-- Publisher trace store, mirroring verdict_traces.sql for the Curator.
--
-- Recreated 2026-09-13: the original file was lost with the rest of
-- orchestration/ (never committed) in an unrelated directory deletion, but
-- the table itself survived live in the database (it is not code, it is
-- data). This file matches the live schema exactly, confirmed by
-- introspection, so a fresh database built from these files gets the same
-- shape the running one already has.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

create table if not exists publication_traces (
  id             bigint generated always as identity primary key,
  submission_id  bigint,
  run_id         text not null,
  slug           text,
  commit_sha     text,
  root           text,
  evidence       text,
  status         text,
  schema_version text,
  trace_jsonl    text not null,
  created_at     timestamptz not null default now()
);

create index if not exists publication_traces_submission
  on publication_traces (submission_id, id desc);

create unique index if not exists publication_traces_root
  on publication_traces (root) where root is not null;
