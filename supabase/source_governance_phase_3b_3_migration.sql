-- Migration for Source Governance Phase 3B.3
-- Safe, idempotent, and backwards-compatible migration.

-- 1. Add scheduling fields to source_endpoints
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_endpoints' and column_name = 'last_verified_at') then
    alter table source_endpoints add column last_verified_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_endpoints' and column_name = 'next_reverification_at') then
    alter table source_endpoints add column next_reverification_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_endpoints' and column_name = 'reverification_interval') then
    alter table source_endpoints add column reverification_interval interval not null default interval '7 days';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_endpoints' and column_name = 'reverification_policy') then
    alter table source_endpoints add column reverification_policy text not null default 'normal' check (reverification_policy in ('high', 'normal', 'low'));
  end if;
end $$;

-- 2. Add scheduling fields to source_collections
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_collections' and column_name = 'last_verified_at') then
    alter table source_collections add column last_verified_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_collections' and column_name = 'next_reverification_at') then
    alter table source_collections add column next_reverification_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_collections' and column_name = 'reverification_interval') then
    alter table source_collections add column reverification_interval interval not null default interval '30 days';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_collections' and column_name = 'reverification_policy') then
    alter table source_collections add column reverification_policy text not null default 'normal' check (reverification_policy in ('high', 'normal', 'low'));
  end if;
end $$;

-- 3. Create first-class source_reverifications table
create table if not exists source_reverifications (
  id bigint generated always as identity primary key,
  subject_type text not null check (subject_type in ('endpoint', 'collection')),
  subject_id bigint not null,
  
  previous_decision_id bigint not null references source_policy_decisions(id) on delete restrict,
  previous_verified_evidence_id bigint not null references source_verified_evidence(id) on delete restrict,
  
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  
  reverifier_version text not null,
  trigger_type text not null check (trigger_type in (
    'scheduled', 'manual', 'redirect_change', 'rights_change_signal', 
    'access_failure', 'endpoint_change', 'collection_change', 'security_signal', 'policy_version_change'
  )),
  
  old_material_fingerprint text not null,
  new_material_fingerprint text not null,
  
  drift_detected boolean not null,
  drift_class text not null check (drift_class in (
    'NO_DRIFT', 'NON_MATERIAL_DRIFT', 'MATERIAL_RIGHTS_DRIFT', 
    'MATERIAL_SCOPE_DRIFT', 'MATERIAL_IDENTITY_DRIFT', 'MATERIAL_ACCESS_DRIFT', 
    'MATERIAL_REDIRECT_DRIFT', 'MATERIAL_COLLECTION_DRIFT', 'MATERIAL_VERIFIER_DRIFT', 'UNRESOLVED_DRIFT'
  )),
  
  drift_codes text[],
  observations jsonb not null,
  
  new_verified_evidence_id bigint references source_verified_evidence(id) on delete restrict,
  new_policy_evaluation_id bigint references source_policy_evaluations(id) on delete restrict,
  new_policy_decision_id bigint references source_policy_decisions(id) on delete restrict,
  
  status text not null check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

-- 4. Apply Immutability Append-Only rules to source_reverifications
create or replace function source_governance_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'source governance audit/policy table is append-only: % refused.', tg_op;
end $$;

drop trigger if exists source_reverifications_append_only on source_reverifications;
create trigger source_reverifications_append_only
  before update or delete on source_reverifications
  for each row execute function source_governance_is_append_only();

drop trigger if exists source_reverifications_no_truncate on source_reverifications;
create trigger source_reverifications_no_truncate
  before truncate on source_reverifications
  for each statement execute function source_governance_is_append_only();

alter table source_reverifications enable always trigger source_reverifications_append_only;
alter table source_reverifications enable always trigger source_reverifications_no_truncate;

-- 5. Privileges and Access Control
revoke all on source_reverifications from public, terraveler_anon;
grant select, insert on source_reverifications to terraveler_service;
grant select, insert on source_reverifications to terraveler_evaluator;
grant usage, select on sequence source_reverifications_id_seq to terraveler_service, terraveler_evaluator;
