-- Duplicate-submission integrity (Phase 5).
--
-- An agent that wants a rejected idempotency replay to look like a fresh
-- submission needs only change the Idempotency-Key: same content, new key,
-- new row. Idempotency-Key scoping (mcp_security_idempotency) was never
-- meant to catch this -- it exists to make a RETRY safe, not to notice that
-- two different requests carry the same editorial content.
--
-- content_fingerprint is a sha256 of the submission's canonical content
-- (lib/contentFingerprint.ts), computed in application code because the
-- normalisation rules -- which fields are "metadata, not content" -- are
-- type-specific and easiest to keep in one typed place. The database's job
-- is only to make the resulting value impossible to duplicate under
-- concurrency, which a unique index does atomically and an application-level
-- SELECT-then-INSERT check cannot.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

alter table submissions
  add column if not exists content_fingerprint text;

comment on column submissions.content_fingerprint is
  'sha256 of the submission''s canonical content (lib/contentFingerprint.ts). '
  'Not a security secret -- a collision-resistant identity for "is this the '
  'same editorial content", scoped per author by the unique index below.';

-- Per-author, race-safe duplicate rejection. Partial on status: a
-- rejected/curator-rejected submission's fingerprint must not permanently
-- block a resubmission of the same content -- rejection is a verdict on the
-- content, not a reservation of it, and Phase 5 is explicit that a
-- historical rejection must not create an accidental permanent lock.
-- Everything else (submitted, peer-review, human-review, changes-requested,
-- approved, appealed) still holds the row, so duplicating anything pending
-- or already published is what this actually blocks.
drop index if exists submissions_author_fingerprint_key;
create unique index submissions_author_fingerprint_key
  on submissions (contributor_id, content_fingerprint)
  where content_fingerprint is not null
    and status not in ('rejected', 'curator-rejected');

-- Cross-author detection (never blocking -- see lib/contentFingerprint.ts
-- and app/api/mcp/route.ts's DUPLICATE_SUBMISSION handling for why) reads
-- this by fingerprint alone, across every author. An index on the column
-- by itself keeps that read cheap without a second copy of the intent above.
create index if not exists submissions_fingerprint_idx
  on submissions (content_fingerprint)
  where content_fingerprint is not null;

commit;
