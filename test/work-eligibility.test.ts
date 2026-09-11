import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

function section(route: string, marker: string, endMarker = '\n    case "') {
  const at = route.indexOf(marker);
  assert.ok(at >= 0, `marker not found: ${marker}`);
  const end = route.indexOf(endMarker, at + marker.length);
  return route.slice(at, end >= 0 ? end : at + 6000);
}

test("list_gaps selects every column adaptEditorialGap needs to represent a reservation", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  assert.match(listGaps, /select=.*requested_agent_account_id/s,
    "without this column a reserved Waypoint silently looks open");
  assert.match(listGaps, /select=.*claimed_by/s);
  assert.match(listGaps, /select=.*waypoint_type/s);
});

test("work eligibility reuses claim_gap's own authenticate() and quotaFor(), not a second policy", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  const claimGap = section(route, 'case "claim_gap"');
  assert.match(listGaps, /authenticate\(args, bearer\)/);
  assert.match(claimGap, /authenticate\(args, bearer\)/);
  assert.match(listGaps, /quotaFor\(c\.rank, c\.handle\)/);
  assert.match(claimGap, /quotaFor\(a\.ok!\.rank, a\.ok!\.handle\)|q\.activeClaims/);
});

test("eligibility's held-claims predicate is at least as strict as claim_gap's own count", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  // The eligibility query ORs both predicates claim_gap's two write lanes use
  // (contributor_id in the OAuth/RPC lane, handle in the legacy lane) — a
  // superset of either alone, so it can only under-count eligibility, never
  // over-count it relative to what the write path actually enforces.
  assert.match(listGaps, /claimed_by_contributor_id\.eq\.\$\{c\.id\}/);
  assert.match(listGaps, /claimed_by\.eq\.\$\{encodeURIComponent\(c\.handle\)\}/);
});

test("reservation eligibility is resolved from the OAuth agent_account_id, never assumed permissive for legacy callers", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  assert.match(listGaps, /agentAccountId:\s*bearer\?\.agent_account_id\s*\?\?\s*null/,
    "a legacy handle+api_key caller must never be treated as matching a reservation it cannot be proven to hold");
  assert.match(listGaps, /reservedFor !== quotaState\.agentAccountId/);
});

test("anonymous callers get a constrained, non-erroring eligibility projection", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  assert.match(listGaps, /if \(!quotaState\)\s*\{\s*eligible = false;/);
  assert.equal(/return `ERROR:/.test(listGaps.slice(0, listGaps.indexOf("your_standing"))), false,
    "list_gaps must stay callable by anonymous connections — eligibility is informational, not a gate on the read itself");
});

test("every waypoint the eligibility projection marks eligible only allows claim_gap, never a stronger action", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  assert.match(listGaps, /allowed_actions:\s*eligible \? \["claim_gap"\] : \[\]/);
  assert.match(listGaps, /blocked_actions:\s*eligible \? \[\] : \["claim_gap"\]/);
});

test("recommended_next_action only ever names an already-eligible waypoint", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const listGaps = section(route, 'case "list_gaps"');
  assert.match(listGaps, /if \(eligible && recommendedWaypointId == null\) recommendedWaypointId = w\.id;/,
    "the recommendation must be assigned inside the eligible branch, not computed independently of it");
});
