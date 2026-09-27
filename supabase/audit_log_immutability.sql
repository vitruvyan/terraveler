-- Audit Log Immutability Invariant
--
-- MAGNA_CARTA.md and docs/SHIPS_OFFICERS.md both already assert "audit_log is
-- canonical" and append-only — but until now that was a claim enforced by
-- convention (no code path happens to PATCH or DELETE it), not by the
-- database. Every "the Curator ruled this way because Y" and every rank
-- computation reads this table as ground truth; if it can be quietly
-- rewritten, every one of those claims stops being checkable. Same pattern
-- as supabase/source_governance_immutability.sql, applied to the one table
-- everything else's auditability rests on.

create or replace function audit_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % refused.', tg_op;
end $$;

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_is_append_only();

alter table audit_log enable always trigger audit_log_append_only;
alter table audit_log enable always trigger audit_log_no_truncate;

-- Revoke update, delete, truncate privileges (defense in depth beside the
-- trigger, matching source_governance_immutability.sql).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'terraveler') then
    revoke update, delete, truncate on audit_log from terraveler;
  end if;
  if exists (select 1 from pg_roles where rolname = 'terraveler_service') then
    revoke update, delete, truncate on audit_log from terraveler_service;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on audit_log from service_role;
  end if;
end $$;
