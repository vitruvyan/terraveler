-- Phase 2A: Source Governance Architectural Schema
-- This establishes the relational footprint for domain discovery, verifiable 
-- evidence collection, immutable policy decisions, and reverification tracking.

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
  
  -- Trust Mode dictates how ingestion fetching interacts with this endpoint
  trust_mode text not null default 'pending'
    check (trust_mode in ('pending', 'domain_trusted', 'collection_trusted', 'item_verified', 'link_only', 'rejected'))
);

create table if not exists source_collections (
  id bigint generated always as identity primary key,
  endpoint_id bigint not null references source_endpoints(id) on delete cascade,
  name text not null,
  path_prefix text,
  status text not null default 'discovered',
  trust_mode text not null default 'pending'
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
  proposed_by_actor_type text not null check (proposed_by_actor_type in ('human', 'agent', 'system')),
  proposed_by_actor_id bigint not null,
  endpoint_id bigint references source_endpoints(id) on delete set null,
  collection_id bigint references source_collections(id) on delete set null,
  status text not null default 'submitted'
);

-- The Evidence Contract (Authored by LLM Archivist, Verified by Deterministic Engine)
create table if not exists source_assessments (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references source_proposals(id) on delete cascade,
  assessed_by_agent_id bigint not null,
  
  rights_scope_type text not null check (rights_scope_type in ('endpoint', 'collection', 'item')),
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
create table if not exists source_policy_decisions (
  id bigint generated always as identity primary key,
  endpoint_id bigint references source_endpoints(id) on delete cascade,
  collection_id bigint references source_collections(id) on delete cascade,
  
  trust_mode text not null,
  rights_class text not null,
  rights_identifier text,
  rights_uri text,
  
  -- Captures the EXACT verified state of the assessment to survive future quarantine
  evidence_snapshot jsonb not null,
  
  carta_version text not null,
  decided_by_actor_type text not null check (decided_by_actor_type in ('human', 'system')),
  decided_by_actor_id text not null, -- E.g. deterministic_engine_v1 or a human's contributor_id
  
  reason text not null,
  timestamp timestamptz default now(),

  check (
    (endpoint_id is not null and collection_id is null) or
    (endpoint_id is null and collection_id is not null)
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
