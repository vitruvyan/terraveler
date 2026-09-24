import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Static assertions on supabase/source_governance_dedup_and_reactivation.sql
// (PR-6, source-governance remediation, 2026-09-24).
//
// This suite stays hermetic like the rest of test/*.test.ts (no live
// Postgres connection -- `npm test` has no database available when CI runs
// it, e.g. .github/workflows/world-events-refresh.yml). The actual RPC
// behavior was verified separately, by hand, in a rollback-only transaction
// against the real database before this migration was ever applied for
// real -- see the migration file's own header for what that covered:
//   1. two proposals, different URLs, same already-active host -> stay
//      separate proposals (not fused into one with two intents)
//   2. two proposals, the identical canonical URL -> still merge as an
//      additional intent on the same proposal (no regression)
//   3. approving a proposal whose host already has a non-active
//      source_endpoints row -> reactivates that row, no UNIQUE violation,
//      no duplicate row
// These tests instead guard the SQL text itself, so a future edit that
// silently reintroduces host/endpoint-based dedup, or a blind INSERT on
// endpoint reactivation, fails CI even without a database to run against.

const sqlPath = join(__dirname, "../supabase/source_governance_dedup_and_reactivation.sql");
const sql = readFileSync(sqlPath, "utf8");

test("mcp_propose_source dedups on exact canonical URL, not endpoint/host", () => {
  // Problem A fix: the dedup lookup must key on target_url = p_canonical_url.
  assert.match(
    sql,
    /where\s+status\s*=\s*'submitted'\s+and\s+target_url\s*=\s*p_canonical_url/i,
    "mcp_propose_source's dedup query MUST match on the exact canonical URL"
  );

  // Regression guard: the old collapse-by-endpoint-or-host OR clause must
  // be gone, not just supplemented -- it's what fused proposal #11.
  assert.equal(
    /endpoint_id\s*=\s*v_endpoint_id\)\s*or/i.test(sql),
    false,
    "mcp_propose_source MUST NOT still dedup by matching endpoint_id (or host) -- " +
      "that's the mechanism that fused unrelated proposals on the same domain"
  );
});

test("mcp_resolve_source_proposal reactivates an existing non-active endpoint row instead of blind-inserting", () => {
  // Problem B fix: before inserting a new source_endpoints row, look up
  // ANY existing row for that host_pattern regardless of status.
  assert.match(
    sql,
    /select\s+id\s+into\s+v_endpoint_id\s+from\s+source_endpoints\s+where\s+host_pattern\s*=\s*v_host\s+limit\s+1/i,
    "mcp_resolve_source_proposal MUST look up an existing endpoint by host_pattern " +
      "(any status) before deciding whether to insert or reactivate"
  );

  // And when found, it must UPDATE (reactivate) rather than fall straight
  // through to INSERT, which would hit source_endpoints_host_pattern_key.
  assert.match(
    sql,
    /if\s+v_endpoint_id\s+is\s+not\s+null\s+then\s+update\s+source_endpoints\s+set\s+status\s*=\s*'active'/i,
    "mcp_resolve_source_proposal MUST reactivate (UPDATE) a pre-existing endpoint row " +
      "for this host instead of inserting a duplicate"
  );
});
