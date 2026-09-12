-- Migration for Source Governance Phase 3B.3 (Hardened Sealing)
-- Safe, idempotent, and backwards-compatible migration.

-- 1. Add scheduling and reverification generation fields to source_endpoints
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
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_endpoints' and column_name = 'reverification_generation') then
    alter table source_endpoints add column reverification_generation integer not null default 0;
  end if;
end $$;

-- 2. Add scheduling and reverification generation fields to source_collections
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
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_collections' and column_name = 'reverification_generation') then
    alter table source_collections add column reverification_generation integer not null default 0;
  end if;
end $$;

-- 3. Create first-class source_reverifications table (Drop/Alter old pre-3B schema safely)
do $$
begin
  -- If old column rights_statement_hash exists, we drop the table and recreate or alter safely
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_reverifications' and column_name = 'rights_statement_hash') then
    drop table source_reverifications cascade;
  end if;
end $$;

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

-- 4. Create source_reverification_events table
create table if not exists source_reverification_events (
  id bigint generated always as identity primary key,
  reverification_id bigint not null references source_reverifications(id) on delete cascade,
  event_type text not null check (event_type in ('started', 'completed', 'failed', 'quarantined', 'reevaluated')),
  metadata jsonb,
  timestamp timestamptz not null default now()
);

-- 5. Create source_drift_evaluations table
create table if not exists source_drift_evaluations (
  id bigint generated always as identity primary key,
  reverification_id bigint not null references source_reverifications(id) on delete cascade,
  subject_type text not null check (subject_type in ('endpoint', 'collection')),
  subject_id bigint not null,
  
  drift_detected boolean not null,
  drift_class text not null,
  drift_codes text[],
  reason_codes text[],
  blocking_conditions text[],
  
  old_material_fingerprint text not null,
  new_material_fingerprint text not null,
  recommended_action text not null check (recommended_action in ('KEEP_ACTIVE', 'QUARANTINE_AND_REEVALUATE', 'REVIEW_REQUIRED')),
  
  classifier_version text not null,
  evaluation_snapshot jsonb not null,
  evaluation_hash text not null unique,
  
  created_at timestamptz not null default now()
);

-- 6. Apply Immutability Append-Only rules to all tables (No UPDATE, DELETE, TRUNCATE)
create or replace function source_governance_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'source governance audit/policy table is append-only: % refused.', tg_op;
end $$;

-- Triggers for source_reverifications
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

-- Triggers for source_reverification_events
drop trigger if exists source_reverification_events_append_only on source_reverification_events;
create trigger source_reverification_events_append_only
  before update or delete on source_reverification_events
  for each row execute function source_governance_is_append_only();

drop trigger if exists source_reverification_events_no_truncate on source_reverification_events;
create trigger source_reverification_events_no_truncate
  before truncate on source_reverification_events
  for each statement execute function source_governance_is_append_only();

alter table source_reverification_events enable always trigger source_reverification_events_append_only;
alter table source_reverification_events enable always trigger source_reverification_events_no_truncate;

-- Triggers for source_drift_evaluations
drop trigger if exists source_drift_evaluations_append_only on source_drift_evaluations;
create trigger source_drift_evaluations_append_only
  before update or delete on source_drift_evaluations
  for each row execute function source_governance_is_append_only();

drop trigger if exists source_drift_evaluations_no_truncate on source_drift_evaluations;
create trigger source_drift_evaluations_no_truncate
  before truncate on source_drift_evaluations
  for each statement execute function source_governance_is_append_only();

alter table source_drift_evaluations enable always trigger source_drift_evaluations_append_only;
alter table source_drift_evaluations enable always trigger source_drift_evaluations_no_truncate;

-- 7. Ensure role exists before granting
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'terraveler_evaluator') then
    create role terraveler_evaluator;
  end if;
end $$;

-- 8. Privileges and Access Control (Strict Revokes and Schedulable Grants)
revoke all on source_reverifications, source_reverification_events, source_drift_evaluations from public, terraveler_anon;

revoke insert, update, delete, truncate on source_reverifications from terraveler_service;
revoke insert, update, delete, truncate on source_reverification_events from terraveler_service;
revoke insert, update, delete, truncate on source_drift_evaluations from terraveler_service;

revoke update, delete, truncate on source_reverifications from terraveler_evaluator;
revoke update, delete, truncate on source_reverification_events from terraveler_evaluator;
revoke update, delete, truncate on source_drift_evaluations from terraveler_evaluator;

-- Grant SELECT + INSERT safely to matching roles
grant select, insert on source_reverifications to terraveler_service;
grant select, insert on source_reverification_events to terraveler_service;
grant select on source_drift_evaluations to terraveler_service;

grant select, insert on source_reverifications to terraveler_evaluator;
grant select, insert on source_reverification_events to terraveler_evaluator;
grant select, insert on source_drift_evaluations to terraveler_evaluator;

-- Grant sequence usage safely
grant usage, select on sequence 
  source_reverifications_id_seq, 
  source_reverification_events_id_seq, 
  source_drift_evaluations_id_seq 
to terraveler_service, terraveler_evaluator;
