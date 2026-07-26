-- Terraveler — let the schema hold the voyages the application already has.
-- Run in psql against the terraveler database, then:
--   docker restart terraveler_postgrest
--
-- Why
-- ---
-- schema.sql dates from the one-voyage prototype and never followed
-- lib/types.ts. The gap only became visible when a loader was written for the
-- bundles in data/, and it turns out the database cannot hold two of the six
-- voyages the site already publishes:
--
--   * `voyages` has no kind/render/body, so Apollo 11 (a surface traverse) and
--     Voyager 2 (an orrery) would come back as ordinary Age-of-Sail voyages and
--     render on a MapLibre world map.
--   * `waypoints.latitude/longitude` are NOT NULL, and Voyager 2's waypoints
--     have neither: they carry heliocentric polar coordinates (r_au, theta_deg).
--     Voyager 2 is not merely lossy to insert — it is impossible.
--   * The bundles carry a media[] array per waypoint; the table has a single
--     media_url, so every image after the first would be dropped on the floor.
--
-- The nullability change is the delicate one. Dropping NOT NULL from latitude
-- would let a waypoint exist with no position at all, which is a worse defect
-- than the one being fixed, so the constraint below replaces it: a waypoint
-- must carry a geographic position OR a heliocentric one. Never neither.

alter table waypoints
  alter column latitude  drop not null,
  alter column longitude drop not null;

alter table waypoints
  add column if not exists r_au      double precision,
  add column if not exists theta_deg double precision,
  add column if not exists body      text,
  add column if not exists is_flyby  boolean,
  -- media_url stays for backward compatibility; media[] is the full record.
  add column if not exists media     jsonb;

do $$
begin
  alter table waypoints add constraint waypoints_has_a_position
    check (
      (latitude is not null and longitude is not null)
      or
      (r_au is not null and theta_deg is not null)
    );
exception when duplicate_object then null;
end $$;

comment on constraint waypoints_has_a_position on waypoints is
  'Every stage is somewhere. Geographic (latitude, longitude) for voyages on a '
  'body''s surface; heliocentric polar (r_au, theta_deg) for a probe. Dropping '
  'the NOT NULL on latitude without this would allow a positionless waypoint.';

alter table voyages
  add column if not exists kind   text,
  add column if not exists render text,
  add column if not exists body   text;

-- NULL means "earth" throughout the application (see lib/types.ts), so these
-- stay nullable rather than defaulting: an absent value is already meaningful,
-- and writing 'earth' into every historical voyage would add noise, not truth.
do $$
begin
  alter table voyages add constraint voyages_kind_check
    check (kind is null or kind in ('earth','surface','space'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table voyages add constraint voyages_render_check
    check (render is null or render in ('earth','surface','orbital'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table voyages add constraint voyages_body_check
    check (body is null or body in ('earth','moon','mars','venus','mercury','titan'));
exception when duplicate_object then null;
end $$;

comment on column voyages.kind is
  'earth (default when null) | surface (a traverse on another body) | space (a '
  'probe rendered on the orrery). Mirrors VoyageKind in lib/types.ts.';
comment on column voyages.render is
  'Explicit renderer selection; when null it is derived from kind by '
  'resolveRender() in lib/voyages.ts.';

-- New columns inherit the table's grants, so nothing to add here — but
-- PostgREST caches the schema and will not serve them until it reloads.
-- See the note in schema.sql about why that file granted nothing at all.
