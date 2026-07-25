-- Terraveler — the demand log: what readers looked for and the atlas lacked.
-- Run in psql AFTER governance_schema.sql. Optional: search works without it
-- (the API records misses best-effort and ignores failures), but with it the
-- editorial roadmap stops being guesswork — the desk can see what people
-- actually came looking for and turn the top rows into editorial_gaps.

create table if not exists search_misses (
  id         bigint generated always as identity primary key,
  query      text not null unique,          -- normalised, lowercased
  hits       int  not null default 1,       -- how many times it was asked for
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  -- open = still unanswered · promoted = turned into an editorial gap ·
  -- dismissed = out of scope, kept so it stops resurfacing on the desk
  status     text not null default 'open' check (status in ('open','promoted','dismissed'))
);

create index if not exists search_misses_open_idx on search_misses (status, hits desc);

-- Upsert as one statement: the API is unauthenticated, so it gets a narrow
-- SECURITY DEFINER function instead of table-level insert/update rights.
create or replace function record_search_miss(q text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into search_misses (query)
  values (lower(btrim(q)))
  on conflict (query) do update
    set hits = search_misses.hits + 1,
        last_seen = now();
$$;

alter table search_misses enable row level security;  -- service-role only

-- PostgREST grants (new objects arrive privilege-less — see
-- governance_peer_review.sql for why, and restart terraveler_postgrest after).
grant select, update on search_misses to terraveler_service;
grant execute on function record_search_miss(text) to terraveler_service;
