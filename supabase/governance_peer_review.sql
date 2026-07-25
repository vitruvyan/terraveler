-- Terraveler peer review — Magna Carta v0.2, §10 (The Crew)
-- Run in psql AFTER governance_schema.sql + governance_hardening.sql.
-- Adds: the 'peer-review' submission state, the reviews table, and
-- reviews_given in the public standing.

-- ------------------------------------------------------------- submission state
-- Drafts that pass the Stage-0 gate now land in 'peer-review', where other
-- Scribes try to refute them before the editor rules.
alter table submissions drop constraint if exists submissions_status_check;
alter table submissions add constraint submissions_status_check
  check (status in ('submitted','curator-rejected','peer-review','human-review',
                    'changes-requested','approved','rejected'));

-- ------------------------------------------------------------------- reviews
create table if not exists reviews (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references submissions(id),
  reviewer_id   bigint not null references contributors(id),
  verdict       text not null check (verdict in ('confirm','refute','unclear')),
  findings      jsonb not null,               -- [{claim, assessment, evidence_url, note}]
  carta_version text not null,
  created_at    timestamptz default now(),
  unique (submission_id, reviewer_id)         -- one review per Scribe per draft
);

alter table reviews enable row level security;  -- service-role only, like submissions

-- ---------------------------------------------------------------- grants
-- On the self-hosted PostgREST, table privileges are granted per-object at
-- setup time: new tables/views arrive privilege-less for the service role
-- (BYPASSRLS skips row security, never table ACLs). After any DDL, PostgREST
-- must also reload its schema cache: `docker restart terraveler_postgrest`.
grant select, insert on reviews to terraveler_service;
grant usage, select on all sequences in schema public to terraveler_service;
alter default privileges in schema public
  grant select, insert, update, delete on tables to terraveler_service;
alter default privileges in schema public
  grant usage, select on sequences to terraveler_service;

-- ------------------------------------------------------- standing with reviews
-- Recreated (not replaced) because the column list grows: reviewing now
-- builds standing alongside authored work (Carta 10.6).
drop view if exists contributor_standing;
create view contributor_standing as
select c.id, c.handle, c.rank,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id and a.actor = 'editor-in-chief' and a.verdict = 'approve') as approvals,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id and a.verdict = 'reject')                                  as rejections,
  (select count(*) from submissions s join audit_log a on a.submission_id = s.id
    where s.contributor_id = c.id and a.actor = 'curator-v0' and a.verdict = 'human-review') as passed_curator,
  (select count(*) from reviews r where r.reviewer_id = c.id)                                as reviews_given
from contributors c;

-- The recreated view loses its previous grants — restore them.
grant select on contributor_standing to terraveler_service;
