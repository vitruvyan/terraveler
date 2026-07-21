-- Terraveler — Chrono-diary of Navigation
-- Schema is intentionally shaped like the future Terraveler entities:
--   Navigator -> Person, Voyage -> Route, Waypoint -> Place+Event, Source -> Evidence.
-- Run this in the Supabase SQL editor.

create table if not exists navigators (
  id           bigint generated always as identity primary key,
  slug         text unique not null,
  name         text not null,
  nationality  text,
  birth_year   int,
  death_year   int,
  portrait_url text,
  bio          text,
  created_at   timestamptz default now()
);

create table if not exists voyages (
  id           bigint generated always as identity primary key,
  navigator_id bigint not null references navigators(id) on delete cascade,
  slug         text unique not null,
  title        text not null,
  ships        text,
  sponsor      text,
  purpose      text,
  start_date   text,   -- kept as text: historical dates are sometimes fuzzy
  end_date     text,
  summary      text,
  created_at   timestamptz default now()
);

create table if not exists waypoints (
  id                    bigint generated always as identity primary key,
  voyage_id             bigint not null references voyages(id) on delete cascade,
  seq                   int not null,
  place_historical      text,
  place_modern          text,
  latitude              double precision not null,
  longitude             double precision not null,
  arrival_date          text,
  departure_date        text,
  date_note             text,
  event                 text,
  diary_excerpt         text,
  diary_source_citation text,
  diary_source_url      text,
  confidence            text not null default 'certain'
                        check (confidence in ('certain','approximate','reconstructed')),
  media_url             text,
  created_at            timestamptz default now(),
  unique (voyage_id, seq)
);

create table if not exists sources (
  id          bigint generated always as identity primary key,
  waypoint_id bigint references waypoints(id) on delete cascade,
  voyage_id   bigint references voyages(id) on delete cascade,
  author      text,
  title       text,
  year        int,
  url         text,
  quote       text
);

create index if not exists waypoints_voyage_seq_idx on waypoints (voyage_id, seq);

-- Public read-only access (all data here is public-domain history).
alter table navigators enable row level security;
alter table voyages    enable row level security;
alter table waypoints  enable row level security;
alter table sources    enable row level security;

create policy "public read navigators" on navigators for select using (true);
create policy "public read voyages"    on voyages    for select using (true);
create policy "public read waypoints"  on waypoints  for select using (true);
create policy "public read sources"    on sources    for select using (true);
