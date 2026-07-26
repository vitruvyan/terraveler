-- Terraveler — make Magna Carta §5's promise of appeal executable.
-- Run in psql, then: docker restart terraveler_postgrest
--
-- §5 says every verdict is "motivated, cited, and appealable to the
-- Editor-in-chief", and §7 says standing is public "because authority must be
-- inspectable". The audit trail was being written faithfully all along — every
-- verdict, review and claim, inside the same transaction as the thing it
-- records — and nothing could read it and nothing could contest it. The data
-- was there; the two doors were not.
--
-- A rank nobody can audit is decoration, and a verdict nobody can appeal is a
-- ruling. This adds the status an appeal puts a submission into; the reading
-- and the appealing themselves are MCP tools (get_audit, appeal).

do $$
begin
  alter table submissions drop constraint if exists submissions_status_check;
  alter table submissions add constraint submissions_status_check
    check (status in (
      'submitted',
      'curator-rejected',
      'peer-review',
      'human-review',
      'changes-requested',
      'approved',
      'rejected',
      'appealed'          -- contested by its author, awaiting the Editor-in-chief
    ));
end $$;

comment on column submissions.status is
  'submitted → curator-rejected | peer-review → human-review → approved | '
  'rejected | changes-requested. A rejected submission may be appealed once by '
  'its author (Carta §5), which moves it to ''appealed'' and back into the '
  'editor''s queue as a distinct kind of work from first-pass review.';

-- One appeal per submission. Enforced here rather than in application code
-- because "appeal until it sticks" is exactly the failure mode an appeal
-- process invites, and a check the database keeps cannot be forgotten by a
-- caller that takes a different path in later.
create unique index if not exists audit_log_one_appeal_per_submission
  on audit_log (submission_id)
  where action = 'appeal';

comment on index audit_log_one_appeal_per_submission is
  'Carta §5 grants an appeal, not an unlimited series of them.';
