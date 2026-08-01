-- Terraveler standing correction — Magna Carta v0.7, §7
-- Run in psql AFTER governance_peer_review.sql (recreates its view).
--
-- The view this replaces could only take standing away. It counted
-- approvals solely under actor 'editor-in-chief', but the Curator's desk
-- records its approvals as 'curator-desk' (scripts/desk_review.py) — so
-- every approval the Curator granted was worth nothing. Meanwhile
-- rejections counted ANY actor with verdict 'reject', including the
-- Stage-0 gate ('curator-gate'), so a formatting mistake weighed the same
-- as an editorial rejection. And 'passed_curator' counted 'curator-v0',
-- an actor the live path never writes. Net effect: a contributor with
-- fifty approved works remained, by the numbers the site showed, a Cabin
-- Boy with a rejection record. §7 says standing can fall AS WELL AS rise;
-- the arithmetic only knew how to fall.

drop view if exists contributor_standing;
create view contributor_standing as
select c.id, c.handle, c.rank,
  -- An approval is an approval whoever lawfully issued it: the editor's
  -- desk or the Curator's (§2 — the verdict is the Curator's to give;
  -- §11 — under commission).
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and a.actor in ('editor-in-chief','curator-desk')
      and a.verdict = 'approve')                                        as approvals,
  -- A rejection is editorial, not mechanical: the Stage-0 gate refusing a
  -- malformed draft is a door that did not open, not a verdict against
  -- the work. Its refusals stay in the audit trail; they do not score.
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and a.actor in ('editor-in-chief','curator-desk')
      and a.verdict = 'reject')                                         as rejections,
  -- "Passed the curator" now means what the live pipeline means by it:
  -- the draft advanced to the human desk. That is recorded as
  -- 'peer-review-complete' today, and as curator-v0's 'human-review' in
  -- the era when that CLI was the path. Both count; neither is invented.
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and (a.action = 'peer-review-complete'
        or (a.actor = 'curator-v0' and a.verdict = 'human-review')))    as passed_curator,
  (select count(*) from reviews r where r.reviewer_id = c.id)           as reviews_given
from contributors c;

-- The recreated view loses its previous grants — restore them.
grant select on contributor_standing to terraveler_service;
