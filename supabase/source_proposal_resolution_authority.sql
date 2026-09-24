-- Source-governance remediation PR-2 (2026-09-24): status = 'resolved' does
-- not say whether a proposal was approved or rejected -- finding out needs
-- a join against source_policy_decisions. mcp_resolve_source_proposal.sql
-- now writes 'approved' or 'rejected' instead of the generic 'resolved'.
--
-- Additive, not a backfill: the 9 proposals already sitting at 'resolved'
-- stay exactly as they are. Nothing reads that literal string looking for
-- an operative decision -- the two real UI/notification consumers
-- (app/api/desk/governance/route.ts, scripts/notify_source_proposals.py)
-- already only test `status != 'submitted'` / `status !== "submitted"` for
-- "no longer pending," so both read 'resolved' and 'approved'/'rejected'
-- identically. Rewriting 9 historical rows to guess which of the two new
-- values they'd have gotten would just be fabricating provenance that
-- wasn't recorded at the time.
--
-- source_proposals.status had no CHECK constraint before this. Adding one
-- now that a second real value exists is cheap insurance against a typo
-- introducing a third, silently-unrecognized status string -- and it has
-- to list 'resolved' alongside 'submitted'/'approved'/'rejected' precisely
-- because those 9 rows must keep validating with no backfill.
--
-- Apply to the canonical PostgreSQL database on the Terraveler VPS.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'source_proposals_status_check'
  ) then
    alter table source_proposals
      add constraint source_proposals_status_check
      check (status in ('submitted', 'resolved', 'approved', 'rejected'));
  end if;
end $$;

commit;
