-- Phase 2A/2B/3A: Source Governance Architectural Schema (Revised)
-- This establishes the footprint for domain discovery, evidence collection,
-- immutable policy decisions, and reverification tracking.

create table if not exists source_institutions (
  id bigint generated always as identity primary key,
  slug text unique not null,
  name text not null,
  country text,
  primary_languages text[]
);

create table if not exists source_endpoints (
  id bigint generated always as identity primary key,
  institution_id bigint references source_institutions(id) on delete set null,
  host_pattern text unique not null,
  match_type text not null check (match_type in ('exact', 'suffix')),
  
  -- Lifecycle Status tracks the operational state of the endpoint
  status text not null default 'discovered'
    check (status in ('discovered', 'proposed', 'triaging', 'assessing', 'policy_check', 'active', 'needs_human_review', 'quarantined', 'rejected', 'retired')),
  
  -- Trust Mode dictates how ingestion fetching interacts with this endpoint (decoupled from status, nullable)
  trust_mode text check (trust_mode in ('domain_trusted', 'collection_trusted', 'item_verified', 'link_only'))
);

create table if not exists source_collections (
  id bigint generated always as identity primary key,
  endpoint_id bigint not null references source_endpoints(id) on delete cascade,
  name text not null,
  path_prefix text,
  status text not null default 'discovered'
    check (status in ('discovered', 'proposed', 'triaging', 'assessing', 'policy_check', 'active', 'needs_human_review', 'quarantined', 'rejected', 'retired')),
  trust_mode text check (trust_mode in ('domain_trusted', 'collection_trusted', 'item_verified', 'link_only'))
);

create table if not exists source_access_rules (
  id bigint generated always as identity primary key,
  -- Scope: must attach to exactly an endpoint OR a collection
  endpoint_id bigint references source_endpoints(id) on delete cascade,
  collection_id bigint references source_collections(id) on delete cascade,
  
  allowed_hosts text[],
  path_patterns text[],
  collection_identifiers text[],
  api_endpoints text[],
  verification_strategy text not null default 'none',
  expected_redirect_hosts text[],

  check (
    (endpoint_id is not null and collection_id is null) or
    (endpoint_id is null and collection_id is not null)
  )
);

create table if not exists source_proposals (
  id bigint generated always as identity primary key,
  target_url text not null,
  -- System proposals removed; only humans and Scribe agents propose sources.
  proposed_by_actor_type text not null check (proposed_by_actor_type in ('human', 'agent')),
  proposed_by_actor_id bigint not null, -- references contributors.id or agent_accounts.id polymorphically
  endpoint_id bigint references source_endpoints(id) on delete set null,
  collection_id bigint references source_collections(id) on delete set null,
  status text not null default 'submitted'
);

-- The Evidence Contract (Authored by LLM Archivist, Verified by Deterministic Engine)
create table if not exists source_assessments (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references source_proposals(id) on delete cascade,
  assessed_by_agent_id bigint not null, -- references agent_accounts.id
  
  -- unresolved scope added as a valid assessment scope (Assessment state only, decisions require endpoint/collection)
  rights_scope_type text not null check (rights_scope_type in ('endpoint', 'collection', 'item', 'unresolved')),
  rights_scope_identifier text,
  
  rights_class text not null check (rights_class in ('public_domain', 'creative_commons', 'mixed', 'in_copyright', 'unknown')),
  rights_identifier text,
  rights_uri text,
  
  machine_readable_rights boolean not null default false,
  rights_statement_url text,
  rights_statement_hash text not null,
  
  created_at timestamptz default now()
);

-- Immutable Decision Record (The actual security authority boundary)
-- Note: Uses ON DELETE RESTRICT to ensure decision provenance survives and prevents cascading deletion of active policy.
create table if not exists source_policy_decisions (
  id bigint generated always as identity primary key,
  endpoint_id bigint references source_endpoints(id) on delete restrict,
  collection_id bigint references source_collections(id) on delete restrict,
  
  trust_mode text not null check (trust_mode in ('domain_trusted', 'collection_trusted', 'item_verified', 'link_only')),
  rights_class text not null check (rights_class in ('public_domain', 'creative_commons', 'mixed', 'in_copyright', 'unknown')),
  rights_identifier text,
  rights_uri text,
  
  -- Captures the EXACT verified state of the assessment to survive future parent removal/quarantine
  evidence_snapshot jsonb not null,
  
  carta_version text not null,
  decided_by_actor_type text not null check (decided_by_actor_type in ('human', 'system')),
  decided_by_actor_id bigint, -- references contributors.id or null when decided_by_actor_type is 'system'
  
  reason text not null,
  timestamp timestamptz default now(),

  check (
    (endpoint_id is not null and collection_id is null) or
    (endpoint_id is null and collection_id is not null)
  ),

  check (
    (decided_by_actor_type = 'system' and decided_by_actor_id is null) or
    (decided_by_actor_type = 'human' and decided_by_actor_id is not null)
  )
);

create table if not exists source_reverifications (
  id bigint generated always as identity primary key,
  decision_id bigint not null references source_policy_decisions(id) on delete cascade,
  rights_statement_hash text not null,
  normalized_fingerprint text not null,
  drift_detected boolean not null default false,
  timestamp timestamptz default now()
);

-- Phase 2B: Shadow Mode Comparison Audit Table
create table if not exists source_governance_comparisons (
  id bigint generated always as identity primary key,
  timestamp timestamptz not null default now(),
  canonical_url text not null,
  legacy_outcome jsonb not null,
  registry_outcome jsonb not null,
  equivalent boolean not null,
  difference_class text check (difference_class in (
    'HOST_MATCH_MISMATCH',
    'TRUST_MODE_MISMATCH',
    'VERIFIER_MISMATCH',
    'ALLOW_DENY_MISMATCH',
    'LICENCE_CLASS_MISMATCH'
  ))
);

-- ----------------------------------------------------------------------------
-- Public views for secure REST exposure (replaces direct table access for anon)
-- ----------------------------------------------------------------------------

create or replace view public_source_endpoints as
  select id, host_pattern, match_type, status, trust_mode
  from source_endpoints;

create or replace view public_source_policy_decisions as
  select id, endpoint_id, collection_id, trust_mode, rights_class, rights_identifier, rights_uri, carta_version, reason, timestamp
  from source_policy_decisions;

create or replace view public_source_proposals as
  select id, target_url, status
  from source_proposals;

-- ----------------------------------------------------------------------------
-- Privileges and Access Control
-- ----------------------------------------------------------------------------

-- Revoke direct select on internal schema tables from anonymous clients to prevent PII leakage
revoke select on
  source_institutions,
  source_endpoints,
  source_collections,
  source_access_rules,
  source_proposals,
  source_assessments,
  source_policy_decisions,
  source_reverifications,
  source_governance_comparisons
from public, terraveler_anon;

-- Grant select only on safe, public-sanitized views to anonymous clients
grant select on public_source_endpoints, public_source_policy_decisions, public_source_proposals to terraveler_anon;

-- Service role retains full administrative privileges
grant select, insert, update, delete on
  source_institutions,
  source_endpoints,
  source_collections,
  source_access_rules,
  source_proposals,
  source_assessments,
  source_policy_decisions,
  source_reverifications,
  source_governance_comparisons
to terraveler_service;
