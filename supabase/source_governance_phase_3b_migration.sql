-- Migration for Source Governance Phase 3B.1 (Deterministic Policy Engine Schema Scaffolding)
-- Safe and idempotent SQL script to migrate an existing pre-3B database schema.

-- 1. Check if the columns already exist, otherwise add them as nullable/defaults
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_policy_decisions' and column_name = 'decision_outcome') then
    alter table source_policy_decisions add column decision_outcome text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_policy_decisions' and column_name = 'policy_version') then
    alter table source_policy_decisions add column policy_version text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_policy_decisions' and column_name = 'verification_version') then
    alter table source_policy_decisions add column verification_version text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'source_policy_decisions' and column_name = 'supersedes_decision_id') then
    alter table source_policy_decisions add column supersedes_decision_id bigint;
  end if;
end $$;

-- 2. Backfill existing legacy decisions
update source_policy_decisions
set
  decision_outcome = 'approve',
  policy_version = 'legacy-v0',
  verification_version = 'legacy-v0'
where decision_outcome is null;

-- 3. Apply NOT NULL constraints
alter table source_policy_decisions alter column decision_outcome set not null;
alter table source_policy_decisions alter column policy_version set not null;
alter table source_policy_decisions alter column verification_version set not null;

-- 4. Apply CHECK constraints (Drop legacy ones first to prevent duplicates/collisions)
alter table source_policy_decisions drop constraint if exists source_policy_decisions_decision_outcome_check;
alter table source_policy_decisions add constraint source_policy_decisions_decision_outcome_check
  check (decision_outcome in ('approve', 'reject', 'needs_human_review'));

-- trust_mode was originally non-nullable. In PostgreSQL we drop the NOT NULL constraint to make it nullable.
alter table source_policy_decisions alter column trust_mode drop not null;

alter table source_policy_decisions drop constraint if exists source_policy_decisions_decision_trust_invariants;
alter table source_policy_decisions add constraint source_policy_decisions_decision_trust_invariants
  check (
    (decision_outcome = 'approve' and trust_mode is not null) or
    (decision_outcome != 'approve' and trust_mode is null)
  );

-- 5. Add supersedes foreign key constraint safely
alter table source_policy_decisions drop constraint if exists source_policy_decisions_supersedes_decision_id_fkey;
alter table source_policy_decisions add constraint source_policy_decisions_supersedes_decision_id_fkey
  foreign key (supersedes_decision_id) references source_policy_decisions(id) on delete restrict;
