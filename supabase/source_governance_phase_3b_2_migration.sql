-- Migration for Source Governance Phase 3B.2
-- Safe, idempotent, and backwards-compatible migration.

-- 1. Create source_verified_evidence table
create table if not exists source_verified_evidence (
  id bigint generated always as identity primary key,
  assessment_id bigint not null references source_assessments(id) on delete cascade,
  proposal_id bigint references source_proposals(id) on delete set null,
  
  verified_at timestamptz not null default now(),
  verifier_version text not null,
  
  institution_identity_verified boolean not null,
  endpoint_identity_verified boolean not null,
  
  rights_statement_retrieved boolean not null,
  rights_statement_hash_matches boolean not null,
  rights_verified boolean not null,
  rights_class text not null check (rights_class in ('public_domain', 'creative_commons', 'mixed', 'in_copyright', 'unknown')),
  rights_identifier text,
  rights_uri text,
  
  scope_verified boolean not null,
  scope_type text not null check (scope_type in ('endpoint', 'collection', 'item', 'unresolved')),
  scope_identifier text,
  
  access_verified boolean not null,
  verification_strategy text not null,
  
  policy_incompatible boolean not null default false,
  incompatibility_codes text[],
  
  conflicts text[],
  evidence_sources text[],
  
  evidence_snapshot jsonb not null,
  evidence_hash text not null unique,
  
  created_at timestamptz not null default now()
);

-- 2. Add proposal_id to source_policy_decisions
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_policy_decisions' and column_name = 'proposal_id') then
    alter table source_policy_decisions add column proposal_id bigint references source_proposals(id) on delete restrict;
  end if;
end $$;

-- 3. Drop existing subject check constraints safely and recreate
alter table source_policy_decisions drop constraint if exists source_policy_decisions_subject_check;
alter table source_policy_decisions drop constraint if exists source_policy_decisions_check;

alter table source_policy_decisions add constraint source_policy_decisions_subject_check
  check (
    (endpoint_id is not null and collection_id is null and proposal_id is null) or
    (endpoint_id is null and collection_id is not null and proposal_id is null) or
    (endpoint_id is null and collection_id is null and proposal_id is not null)
  );

-- 4. Update view public_source_policy_decisions to include proposal_id
create or replace view public_source_policy_decisions as
  select id, endpoint_id, collection_id, proposal_id, decision_outcome, trust_mode, rights_class, rights_identifier, rights_uri, policy_version, verification_version, supersedes_decision_id, carta_version, reason, timestamp
  from source_policy_decisions;

-- 5. Privileges and Access Control
revoke select on source_verified_evidence from public, terraveler_anon;
grant select, insert, update, delete on source_verified_evidence to terraveler_service;
