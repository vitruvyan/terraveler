-- Correcting the record without editing it.
--
-- Four editorial desk routes each held their own CARTA_VERSION and all four
-- said "0.2" long after the Carta had moved to 0.4. Every verdict those routes
-- recorded therefore carries a version that was not in force when it was given.
-- Carta §3.5 makes the audit trail the record of which rules governed each
-- decision, so those rows are not merely untidy: they are false.
--
-- The obvious repair is an UPDATE. It is also the wrong one. An audit trail
-- that can be silently corrected is not an audit trail, and "the desk quietly
-- rewrote its own past verdicts to say something more flattering" is precisely
-- the shape of the thing this project exists not to do — the external Scribe
-- who found the discrepancy said so before I did.
--
-- So the erroneous value stays exactly where it is, and a correction event is
-- appended beside it naming what was recorded, what was actually in force, and
-- why they differ. A reader of the trail sees both, which is the point.
--
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     < supabase/carta_version_correction.sql

insert into audit_log (submission_id, actor, action, verdict, findings, carta_version)
select
  a.submission_id,
  'editor-in-chief',
  'correction',
  'carta-version-misrecorded',
  jsonb_build_array(jsonb_build_array(
    'CORRECTION', 0,
    'The verdict row for this submission records carta_version ' ||
    quote_literal(a.carta_version) || '. That is not the constitution the verdict ' ||
    'was given under: it is a stale constant that four editorial desk routes each ' ||
    'declared separately and never updated. The submission itself declares ' ||
    quote_literal(coalesce(s.carta_version, 'unknown')) || ', which is what was in ' ||
    'force. The original row is left untouched on purpose — an audit trail that ' ||
    'can be edited is not one. Fixed at source by moving the constant to ' ||
    'lib/carta.ts; test/carta.test.ts now fails the build if any file declares ' ||
    'its own, in TypeScript or in Python.'
  )),
  s.carta_version
from audit_log a
join submissions s on s.id = a.submission_id
where a.action = 'verdict'
  -- A verdict OLDER than the draft it judges is impossible: the constitution
  -- only moves forward, so a ruling cannot have been given under a version that
  -- had already been superseded when the draft was written. That is the
  -- signature of the stale constant, and nothing else has it.
  --
  -- The first version of this file compared the two for mere inequality, which
  -- also flags every submission judged after an amendment — the normal course
  -- of things, and six false corrections went into the log before I noticed.
  and string_to_array(a.carta_version, '.')::int[]
    < string_to_array(s.carta_version, '.')::int[]
  -- Do not stack corrections if this is run twice.
  and not exists (
    select 1 from audit_log c
    where c.submission_id = a.submission_id and c.action = 'correction'
  );

select a.submission_id, a.action, a.verdict, a.carta_version
from audit_log a
where a.action in ('verdict', 'correction')
order by a.submission_id, a.id;
