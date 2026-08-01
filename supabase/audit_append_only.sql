-- Terraveler audit_log — append-only, enforced — Magna Carta v0.7, §3.5
-- Run in psql AFTER governance_schema.sql.
--
-- Three documents already said this table was append-only
-- (governance_schema.sql's own comment, §3.5 "recorded forever", and
-- carta_version_correction.sql's whole argument: "an audit trail that can
-- be silently corrected is not an audit trail"). None of them was a
-- privilege. The schema's default grants handed the service role UPDATE
-- and DELETE on every table, this one included — so append-only was a
-- convention among the SQL files, kept only because nobody had yet
-- written the statement that breaks it. With officers standing watch
-- (§11), the whole system's trustworthiness rests on this table; a
-- promise this load-bearing gets a trigger, not a comment.

create or replace function audit_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'audit_log is append-only (Carta §3.5): % refused. A wrong entry is '
    'corrected the way carta_version_correction.sql corrects one — by a '
    'new entry that names the old.', tg_op;
end $$;

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_is_append_only();

-- ENABLE ALWAYS: session_replication_role = replica (pg_restore
-- --disable-triggers, replication, migration tools) skips ordinary
-- triggers, and the everyday scripts connect as the superuser this
-- container was born with — one session GUC must not be the difference
-- between append-only and not.
alter table audit_log enable always trigger audit_log_append_only;
alter table audit_log enable always trigger audit_log_no_truncate;

-- Belt beside the braces: the service role loses the privileges it never
-- should have held here. Both roles are guarded — this file must run to
-- the end on a database that has either, not abort between the triggers
-- and the revokes.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'terraveler_service') then
    revoke update, delete, truncate on audit_log from terraveler_service;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on audit_log from service_role;
  end if;
end $$;
