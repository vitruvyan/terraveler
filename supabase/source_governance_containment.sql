-- Containment fix from a source-governance audit (2026-09-24). Two problems
-- found on the live database, already applied directly there — this file is
-- the record for the repo and for replaying on any other environment.
--
-- 1. test-governance-verify.example.org (source_endpoints.id = 10) was left
--    at status='active' from testing mcp_resolve_source_proposal. It counted
--    toward the "active sources" total shown to the editor and, in principle,
--    toward whatever /api/sources reports publicly.
--
-- 2. www.gutenberg.org (source_endpoints.id = 2) had two 'approve' decisions:
--    id 2 (2026-09-14, system) with the real justification ("Legacy
--    whitelist: Gutenberg is entirely PD."), and id 17 (2026-09-14, human),
--    which was a one-off test of the Telegram button flow whose reason text
--    says exactly that ("Test end-to-end Telegram button flow (thrown-away
--    test proposal...)"). Nothing in the schema tracks which approve decision
--    for an endpoint is the operative one beyond "most recent by timestamp",
--    so decision 17 silently became the reason shown for Gutenberg on the
--    public source catalogue.
--
-- source_policy_decisions is append-only (source_governance_immutability.sql
-- forbids UPDATE/DELETE), so decision 17 cannot be corrected in place. The
-- fix appends a new decision that supersedes it — the first real use of
-- supersedes_decision_id, which existed in the schema but no installed
-- function had ever populated.
--
-- Apply after source_governance_schema.sql. Idempotent: both statements are
-- guarded so replaying this file after it already ran is a no-op.

begin;

update source_endpoints
   set status = 'retired'
 where id = 10
   and host_pattern = 'test-governance-verify.example.org'
   and status = 'active';

insert into source_policy_decisions
  (endpoint_id, decision_outcome, trust_mode, rights_class, evidence_snapshot,
   policy_version, verification_version, supersedes_decision_id, carta_version,
   decided_by_actor_type, decided_by_actor_id, reason)
select
  2, 'approve', 'domain_trusted', 'public_domain',
  jsonb_build_object('restores', 'decision 2', 'reason_for_supersede',
    'decision 17 was a Telegram webhook test-flow verification, not an operative justification'),
  'human-v1', 'human-v1', 17, '0.7',
  'human', 1,
  'Legacy whitelist: Gutenberg is entirely PD. (Restored — decision 17 was a Telegram button-flow test, not this endpoint''s operative justification.)'
where not exists (
  select 1 from source_policy_decisions where supersedes_decision_id = 17
);

commit;
