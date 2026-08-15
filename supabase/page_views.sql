-- Terraveler — pageviews: the simplest possible answer to "is anyone
-- visiting at all". Run in psql AFTER search_misses.sql. One row per page
-- load; no session/visitor identity, no dedup, no bot filtering — v1 is a
-- raw count, on purpose. Optional, like search_misses: the beacon is
-- best-effort and swallows failures, so the site works with or without it.

create table if not exists page_views (
  id            bigint generated always as identity primary key,
  path          text not null,
  referrer_host text,
  viewed_at     timestamptz not null default now()
);

create index if not exists page_views_viewed_at_idx on page_views (viewed_at desc);

-- p_-prefixed params so they can never collide with the columns they fill
-- (see search_misses.sql's q/query split for why that matters here).
create or replace function record_page_view(p_path text, p_referrer_host text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into page_views (path, referrer_host)
  values (p_path, p_referrer_host);
$$;

alter table page_views enable row level security;  -- service-role only, like search_misses

-- PostgREST grants (new objects arrive privilege-less — see
-- governance_peer_review.sql for why, and restart terraveler_postgrest
-- after). No insert/update on the table itself: every write goes through
-- the function above, which runs as its owner regardless of the caller's
-- own grants. select is for the admin route's direct reads.
grant select on page_views to terraveler_service;
grant execute on function record_page_view(text, text) to terraveler_service;

-- governance_peer_review.sql's `alter default privileges ... grant select,
-- insert, update, delete on tables to terraveler_service` reaches every new
-- table created by the same role, this one included — confirmed live: right
-- after the grant above, terraveler_service could still insert/update/delete
-- page_views directly. Revoke explicitly rather than rely on the select
-- grant alone, so the table's actual privileges match what this file says
-- they are.
revoke insert, update, delete on page_views from terraveler_service;
