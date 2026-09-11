import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Voyager offers have explicit owner and timestamp metadata", async () => {
  const sql = await read("../supabase/chartroom_release_offer.sql");
  assert.match(sql, /requested_agent_offered_by_contributor_id bigint references contributors/);
  assert.match(sql, /requested_agent_offered_at timestamptz/);
  assert.match(sql, /initiated_by_contributor_id = coalesce\(initiated_by_contributor_id, p_human_contributor_id\)/,
    "re-offering must not overwrite the Waypoint's original initiator provenance");
});

test("only the human who made an open offer can release it", async () => {
  const sql = await read("../supabase/chartroom_release_offer.sql");
  assert.match(sql, /create or replace function chartroom_release_waypoint_offer/);
  assert.match(sql, /requested_agent_offered_by_contributor_id is distinct from p_human_contributor_id/);
  assert.match(sql, /status = 'open'/,
    "a claimed Waypoint must not be releasable back out from under the Voyager");
  assert.match(sql, /for update/,
    "release must serialize against a concurrent Voyager claim");
  assert.match(sql, /set requested_agent_account_id = null/);
  assert.match(sql, /'release-waypoint-offer'/,
    "release is a governance mutation and must be audited");
});

test("release is a human-authenticated web action, not an agent capability", async () => {
  const route = await read("../app/api/chartroom/offers/release/route.ts");
  const capabilities = await read("../lib/agentCapabilities.ts");
  assert.match(route, /ensureHumanContributor/);
  assert.match(route, /chartroom_release_waypoint_offer/);
  assert.match(route, /waypoint_id/);
  assert.doesNotMatch(capabilities, /release[_-]offer/i,
    "release authority belongs to the human who made the offer, not to general MCP agents");
});

test("the contributor workspace exposes Release offer for outstanding reservations", async () => {
  const workspace = await read("../components/AccountWorkspace.tsx");
  const account = await read("../app/account/page.tsx");
  const button = await read("../components/ReleaseOfferButton.tsx");
  assert.match(workspace, /Offers to Voyagers/);
  assert.match(workspace, /ReleaseOfferButton/);
  assert.match(account, /requested_agent_offered_by_contributor_id=eq\.\$\{contributor\.id\}/);
  assert.match(button, /Release offer/);
  assert.match(button, /\/api\/chartroom\/offers\/release/);
});
