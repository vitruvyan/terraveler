-- Terraveler human-anchored rank promotion
-- Run in psql AFTER standing_correction.sql (recreates its view).
--
-- Adds abandoned_claims to contributor_standing: the one column the human
-- rank promotion in lib/rankPromotion.ts needs that the view did not already
-- carry. scripts/desk_graph.py's read_dossier already computes this exact
-- count per reviewer (audit_log rows with action='claim-abandoned' and
-- actor='contributor:'||handle) to feed reviewer_has_negative_signal(); this
-- puts the same count on the view that already carries the other three
-- standing numbers (approvals, rejections, reviews_given), rather than
-- inventing a second query for it.

drop view if exists contributor_standing;
create view contributor_standing as
select c.id, c.handle, c.rank,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and a.actor in ('editor-in-chief','curator-desk','curator-v0')
      and a.verdict = 'approve')                                        as approvals,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and a.actor in ('editor-in-chief','curator-desk','curator-v0')
      and a.verdict = 'reject')                                         as rejections,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id
      and (a.action = 'peer-review-complete'
        or (a.actor = 'curator-v0' and a.verdict = 'human-review')))    as passed_curator,
  (select count(*) from reviews r where r.reviewer_id = c.id)           as reviews_given,
  -- Mirrors scripts/desk_graph.py's read_dossier abandoned_claims subquery
  -- exactly: actor is stamped 'contributor:'||handle, not the numeric id,
  -- for every 'claim-abandoned' row the reap job writes.
  (select count(*) from audit_log a5
    where a5.action = 'claim-abandoned'
      and a5.actor = 'contributor:' || c.handle)                        as abandoned_claims
from contributors c;

-- The recreated view loses its previous grants — restore them.
grant select on contributor_standing to terraveler_service;
