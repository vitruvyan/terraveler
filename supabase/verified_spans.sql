-- The only text the atlas may publish.
--
-- Carta §3.4 says a quotation is located in its source and copied from it. The
-- ingestion pipeline does that. Nothing else did: a draft arriving through MCP
-- passed the Stage-0 gate, entered peer review, and was published straight from
-- `evidence.quote` — the contributor's own typing. An external review proved it
-- end to end:
--
--     source:    The Voyage began.
--     submitted: the voyage began.
--     curator:   PASS — VERIFIED VERBATIM
--     published: the voyage began.
--
-- Every check passed and the atlas printed a sentence the page does not
-- contain. The guarantee held only for work that happened to come through the
-- one path that materialised the span.
--
-- So the span becomes a stored artefact rather than a step in a script.
-- desk_review.py writes it during verification; publish_submission.py reads it
-- and refuses to publish a quotation that has none. There is no fallback to
-- contributor text, because a fallback is exactly how this was reintroduced
-- once already.
--
-- Keyed one row per submission, holding one entry per claim:
--
--   {"3.1": {"raw_span": "...", "reading_span": "...",
--            "transformations": ["line-break-rejoin"],
--            "source_url": "...", "source_sha256": "...",
--            "start_offset": 41233, "length": 184,
--            "verified_at": "...", "carta_version": "0.5"}}
--
-- The hash and the offset are what make it checkable later: a source that is
-- rescanned or re-OCR'd changes its hash, and a quotation verified against
-- bytes nobody can produce again is a quotation nobody can re-check.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/verified_spans.sql

create table if not exists verified_spans (
  submission_id bigint primary key references submissions(id),
  spans         jsonb not null,
  carta_version text  not null,
  verified_at   timestamptz not null default now()
);

comment on table verified_spans is
  'Quotation spans located in and copied from their sources, keyed '
  '"<waypoint seq>.<claim index>". The publisher reads this and never the '
  'submitted payload: a quotation with no entry here is not publishable, '
  'whatever the submission says.';
