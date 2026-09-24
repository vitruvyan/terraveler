-- Source search adapters — makes discovery data-driven off the governance
-- registry instead of two names hardcoded in ingest/oculus.py.
--
-- The registry (source_endpoints / source_institutions) is already the
-- authority on what may be FETCHED — whitelist.is_allowed() / verify_source()
-- decide that, and this migration does not touch them. But nothing in that
-- registry says what oculus can SEARCH. Fourteen endpoints are `active`
-- (Gutenberg family, wikisource/wikipedia/wikimedia by suffix, runeberg.org,
-- archive.org, plus five institutions with no search adapter at all:
-- ctext.org, dl.ndl.go.jp, bndigital.bnportugal.gov.pt, www.dbnl.org,
-- www.wdl.org) while discovery only ever looked at Gutenberg and Wikipedia.
-- Adding a source to the whitelist never made it discoverable.
--
-- This table is a CAPABILITY registry, not a TRUST registry: "can we search
-- something here" is a different question from "are we allowed to ingest
-- what we find", and the two must stay separable. A row here can only narrow
-- what gets searched inside what verify_source() already permits — it can
-- never widen it. Every URL an adapter produces still has to clear
-- whitelist.is_allowed()/verify_source() unchanged; a misconfigured adapter
-- (e.g. an api_base_template pointing off-whitelist) must fail as a Rejection
-- naming the adapter, never as a silent HTTP request. See
-- ingest/source_registry.py for the enforcement of that invariant.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS:
--   docker exec -i terraveler_postgres psql -U terraveler -d terraveler \
--     -v ON_ERROR_STOP=1 < supabase/source_search_adapters.sql

begin;

create table source_search_adapters (
  id             bigint generated always as identity primary key,
  endpoint_id    bigint references source_endpoints(id) on delete cascade,
  institution_id bigint references source_institutions(id) on delete cascade,
  adapter        text not null,
  config         jsonb not null default '{}',
  capability     text not null check (capability in ('search','verify_only')),
  enabled        boolean not null default true,
  priority       int not null default 100,
  max_candidates int not null default 5,
  notes          text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check ((endpoint_id is not null) <> (institution_id is not null))
);

create index source_search_adapters_endpoint_idx on source_search_adapters (endpoint_id);
create index source_search_adapters_institution_idx on source_search_adapters (institution_id);
create index source_search_adapters_active_idx on source_search_adapters (priority) where enabled;

comment on table source_search_adapters is
  'Consultative capability registry for ingest/oculus.py discovery: which '
  'adapter can search which endpoint/institution, and with what config. '
  'Purely descriptive — it never grants trust. whitelist.is_allowed() / '
  'verify_source() remain the sole authority on what may be fetched.';
comment on column source_search_adapters.capability is
  '''search'' = the adapter can propose candidates for a subject. '
  '''verify_only'' = the endpoint is trusted per-item (e.g. archive.org) but '
  'no search is implemented against it in this build.';

-- ---------------------------------------------------------------- seed
--
-- Reflects the registry as it stands today (verified against
-- source_institutions/source_endpoints before writing this, not assumed):
--   1=gutenberg  2=runeberg  3=wikimedia  4=archive-org
--   endpoints: 1/2/3=gutenberg.org family (inst 1), 4=runeberg.org (inst 2),
--   5=.wikisource.org 6=.wikipedia.org 7=.wikimedia.org (all inst 3),
--   8/9=archive.org family (inst 4), 10-15=institution-less (the test
--   fixture + the five ungoverned-by-adapter institutions).
--
-- Gutenberg is hooked by INSTITUTION_id rather than by any one of its three
-- endpoints: gutenberg.org, www.gutenberg.org and gutendex.com are three
-- `source_endpoints` rows for what is operationally one search surface
-- (Gutendex indexes the same catalogue those two domains serve), so one
-- adapter row covers all three instead of three identical rows that would
-- drift out of sync with each other.
insert into source_search_adapters (institution_id, adapter, config, capability, priority, max_candidates, notes) values
  (1, 'gutendex', '{}'::jsonb, 'search', 10, 3,
   'Covers gutenberg.org / www.gutenberg.org / gutendex.com with one '
   'institution-level hook: three endpoint rows, one search index.');

-- Wikipedia and Wikisource are hooked per-ENDPOINT rather than by their
-- shared "wikimedia" institution, because each needs its own kind/licence in
-- `config` (Wikisource is Public domain content, Wikipedia is CC BY-SA) even
-- though both endpoints sit under source_institutions.id=3.
insert into source_search_adapters (endpoint_id, adapter, config, capability, priority, max_candidates, notes) values
  (5, 'mediawiki_search',
   '{"api_base_template": "https://{lang}.wikisource.org/w/api.php", "kind": "wikisource", "license": "Public domain"}'::jsonb,
   'search', 20, 8,
   'Same MediaWiki search API as Wikipedia, generalized by host/kind/license instead of hardcoded to wikipedia.org.'),
  (6, 'mediawiki_search',
   '{"api_base_template": "https://{lang}.wikipedia.org/w/api.php", "kind": "wikipedia", "license": "CC BY-SA 4.0"}'::jsonb,
   'search', 20, 8,
   'The existing wikipedia_candidates() behaviour from oculus.py, made declarative.');

-- .wikimedia.org (endpoint 7, Commons) is deliberately NOT given a row here.
-- Commons is an IMAGE search (fetch.commons_images), already invoked
-- unconditionally per subject via `image_terms` — a different shape of
-- result (image docs, not oculus `candidates`) than either capability this
-- table models. Tagging it 'search' would misrepresent it (it produces no
-- text candidates for the curator) and 'verify_only' would misrepresent it
-- too (nothing here waits for per-item verification; commons_images() does
-- its own per-file PD/CC license filter already). Routing Commons through
-- this table needs a third capability class this PR does not add. The gap
-- query below will therefore list .wikimedia.org as adapter-less, which is
-- accurate for TEXT search and not a sign anything is broken.

-- archive.org requires per-item verification (whitelist.verify_archive_item),
-- never a domain-wide guarantee — see supabase/source_governance_schema.sql
-- and ingest/whitelist.py's own header for why. No search adapter is
-- implemented against it in this PR; `archive_org_metadata` here only
-- declares the verification capability that source_access_rules already
-- describes, so the registry has one consistent place to read it from.
insert into source_search_adapters (institution_id, adapter, config, capability, priority, max_candidates, notes) values
  (4, 'archive_org_metadata', '{}'::jsonb, 'verify_only', 90, 0,
   'Per-item verification only (whitelist.verify_archive_item / '
   'source_access_rules.verification_strategy). No search implemented in PR-1.');

-- ---------------------------------------------------------------- privileges
--
-- Same shape as the governance tables in source_governance_schema.sql:
-- terraveler_service gets full CRUD (the Desk/API surface that will let a
-- human manage adapters is a follow-up, not built in this PR, but the grant
-- belongs with the table so that follow-up isn't also a migration). Not
-- exposed to terraveler_anon — this is operational configuration, not public
-- governance record, and no public view is defined for it here.
grant select, insert, update, delete on source_search_adapters to terraveler_service;
grant usage, select on sequence source_search_adapters_id_seq to terraveler_service;

commit;
