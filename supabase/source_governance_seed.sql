-- Idempotent Seed for Legacy Source Governance Registry
-- Reproduces current whitelist.py semantics exactly.

-- 1. Insert institutions
insert into source_institutions (id, slug, name, primary_languages) values
  (1, 'gutenberg', 'Project Gutenberg', array['en']),
  (2, 'runeberg', 'Project Runeberg', array['sv', 'no', 'da']),
  (3, 'wikimedia', 'Wikimedia Foundation', array['mul']),
  (4, 'archive-org', 'Internet Archive', array['mul'])
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  primary_languages = excluded.primary_languages;

-- 2. Insert endpoints
insert into source_endpoints (id, institution_id, host_pattern, match_type, status, trust_mode) values
  (1, 1, 'gutenberg.org', 'exact', 'active', 'domain_trusted'),
  (2, 1, 'www.gutenberg.org', 'exact', 'active', 'domain_trusted'),
  (3, 1, 'gutendex.com', 'exact', 'active', 'domain_trusted'),
  (4, 2, 'runeberg.org', 'exact', 'active', 'domain_trusted'),
  (5, 3, '.wikisource.org', 'suffix', 'active', 'domain_trusted'),
  (6, 3, '.wikipedia.org', 'suffix', 'active', 'domain_trusted'),
  (7, 3, '.wikimedia.org', 'suffix', 'active', 'domain_trusted'),
  (8, 4, 'archive.org', 'exact', 'active', 'item_verified'),
  (9, 4, 'www.archive.org', 'exact', 'active', 'item_verified')
on conflict (id) do update set
  institution_id = excluded.institution_id,
  host_pattern = excluded.host_pattern,
  match_type = excluded.match_type,
  status = excluded.status,
  trust_mode = excluded.trust_mode;

-- 3. Insert access rules
insert into source_access_rules (id, endpoint_id, allowed_hosts, api_endpoints, verification_strategy) values
  (1, 8, array['archive.org'], array['https://archive.org/metadata/'], 'archive_org_metadata'),
  (2, 9, array['www.archive.org'], array['https://archive.org/metadata/'], 'archive_org_metadata')
on conflict (id) do update set
  endpoint_id = excluded.endpoint_id,
  allowed_hosts = excluded.allowed_hosts,
  api_endpoints = excluded.api_endpoints,
  verification_strategy = excluded.verification_strategy;

-- 4. Insert policy decisions
insert into source_policy_decisions (id, endpoint_id, trust_mode, rights_class, rights_identifier, evidence_snapshot, carta_version, decided_by_actor_type, decided_by_actor_id, reason) values
  (1, 1, 'domain_trusted', 'public_domain', null, '{"rights_class": "public_domain", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Gutenberg is entirely PD.'),
  (2, 2, 'domain_trusted', 'public_domain', null, '{"rights_class": "public_domain", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Gutenberg is entirely PD.'),
  (3, 3, 'domain_trusted', 'public_domain', null, '{"rights_class": "public_domain", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Gutenberg is entirely PD.'),
  (4, 4, 'domain_trusted', 'public_domain', null, '{"rights_class": "public_domain", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Runeberg is entirely PD.'),
  (5, 5, 'domain_trusted', 'public_domain', null, '{"rights_class": "public_domain", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Wikisource suffix is PD.'),
  (6, 6, 'domain_trusted', 'creative_commons', 'CC-BY-SA-4.0', '{"rights_class": "creative_commons", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Wikipedia suffix is CC-BY-SA-4.0.'),
  (7, 7, 'domain_trusted', 'mixed', 'per-file (PD/CC, verified)', '{"rights_class": "mixed", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Wikimedia Commons is per-file PD/CC.'),
  (8, 8, 'item_verified', 'mixed', null, '{"rights_class": "mixed", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Internet Archive requires per-item metadata validation.'),
  (9, 9, 'item_verified', 'mixed', null, '{"rights_class": "mixed", "rights_scope_type": "endpoint", "rights_statement_hash": "mock"}'::jsonb, '0.7', 'system', null, 'Legacy whitelist: Internet Archive requires per-item metadata validation.')
on conflict (id) do update set
  endpoint_id = excluded.endpoint_id,
  trust_mode = excluded.trust_mode,
  rights_class = excluded.rights_class,
  rights_identifier = excluded.rights_identifier,
  evidence_snapshot = excluded.evidence_snapshot,
  carta_version = excluded.carta_version,
  decided_by_actor_type = excluded.decided_by_actor_type,
  decided_by_actor_id = excluded.decided_by_actor_id,
  reason = excluded.reason;

-- 5. Seed the durable specialist Archivist agent identity (Phase 3A)
insert into contributors (id, handle, rank, status, human_sponsor) values
  (888, 'archivist', 'navigator', 'active', 'System')
on conflict (id) do update set
  status = excluded.status;

insert into agent_accounts (id, contributor_id, public_id, status) values
  (888, 888, 'system-archivist', 'active')
on conflict (id) do update set
  contributor_id = excluded.contributor_id,
  status = excluded.status;
