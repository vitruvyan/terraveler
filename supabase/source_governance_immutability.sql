-- Source Governance Immutability Invariant
-- Decoupled from operational status, this enforces append-only rules for policy
-- decisions, assessments, and reverification traces to guarantee complete
-- permanent auditability of our trust boundaries.

create or replace function source_governance_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'source governance audit/policy table is append-only: % refused.', tg_op;
end $$;

-- 1. Enforce on source_policy_decisions
drop trigger if exists source_policy_decisions_append_only on source_policy_decisions;
create trigger source_policy_decisions_append_only
  before update or delete on source_policy_decisions
  for each row execute function source_governance_is_append_only();

drop trigger if exists source_policy_decisions_no_truncate on source_policy_decisions;
create trigger source_policy_decisions_no_truncate
  before truncate on source_policy_decisions
  for each statement execute function source_governance_is_append_only();

alter table source_policy_decisions enable always trigger source_policy_decisions_append_only;
alter table source_policy_decisions enable always trigger source_policy_decisions_no_truncate;

-- 2. Enforce on source_assessments
drop trigger if exists source_assessments_append_only on source_assessments;
create trigger source_assessments_append_only
  before update or delete on source_assessments
  for each row execute function source_governance_is_append_only();

drop trigger if exists source_assessments_no_truncate on source_assessments;
create trigger source_assessments_no_truncate
  before truncate on source_assessments
  for each statement execute function source_governance_is_append_only();

alter table source_assessments enable always trigger source_assessments_append_only;
alter table source_assessments enable always trigger source_assessments_no_truncate;

-- 3. Enforce on source_reverifications
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

-- Revoke update, delete, truncate privileges
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'terraveler_service') then
    revoke update, delete, truncate on source_policy_decisions, source_assessments, source_reverifications from terraveler_service;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on source_policy_decisions, source_assessments, source_reverifications from service_role;
  end if;
end $$;
