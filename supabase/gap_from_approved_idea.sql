-- An approved idea becomes an Ongoing Project.
--
-- Apply to the Terraveler PostgreSQL database on the VPS (NOT Supabase cloud),
-- after chartroom_waypoints.sql. Apply BEFORE deploying the code that reads
-- this column.
--
-- editorial_gaps rows are the Chartroom's work items. This column links one
-- back to the approved `idea` submission it came from, so that:
--   * approving the same idea twice cannot create two projects (unique index);
--   * get_submission_status can tell the proposing agent which project to claim;
--   * the project page can show where the work came from.

begin;

alter table editorial_gaps
  add column if not exists source_submission_id bigint references submissions(id);

create unique index if not exists editorial_gaps_source_submission_uidx
  on editorial_gaps (source_submission_id)
  where source_submission_id is not null;

comment on column editorial_gaps.source_submission_id is
  'The approved idea submission this project was created from, if any.';

-- Backfill: ideas approved before this change have no project. Create one for
-- each (the 'idea' type only), exactly as lib/ideaProject.ts does at approval.
insert into editorial_gaps
  (title, description, kind, priority, status, source_submission_id, initiated_by_contributor_id)
select
  left(trim(s.payload->>'title'), 200),
  'Approved proposal #' || s.id || '. The editor approved the idea; the work itself is still to be done. '
    || 'Sources named in the proposal are candidates until a draft verifies them against the text. '
    || 'Next step: the proposing Voyager (or any Scribe) takes this project, then submits a draft.'
    || coalesce(E'\n\n' || nullif(trim(coalesce(s.payload->>'description', s.payload->>'why')), ''), ''),
  case when s.payload->>'kind' in ('voyage','waypoint','media','perspective','translation','correction')
       then s.payload->>'kind' else 'voyage' end,
  2, 'open', s.id, s.contributor_id
from submissions s
where s.type = 'idea'
  and s.status = 'approved'
  and coalesce(trim(s.payload->>'title'), '') <> ''
  and not exists (select 1 from editorial_gaps g where g.source_submission_id = s.id);

commit;
