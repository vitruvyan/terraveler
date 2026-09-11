import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WAYPOINT_CONTEXT_TYPES,
  WAYPOINT_STATUSES,
  WAYPOINT_TYPES,
  adaptEditorialGap,
  legacyKindForWaypointType,
} from "../lib/chartroom";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("the Waypoint vocabulary covers every requested atomic work type", () => {
  assert.deepEqual(WAYPOINT_TYPES, [
    "source", "image", "map", "claim", "transcription", "translation",
    "narrative", "review", "challenge",
  ]);
  assert.deepEqual(WAYPOINT_STATUSES, [
    "open", "taken", "submitted", "in_review", "changes_requested",
    "accepted", "declined", "withdrawn",
  ]);
  assert.deepEqual(WAYPOINT_CONTEXT_TYPES, ["atlas", "voyage", "voyage_waypoint"]);
});

test("legacy editorial gaps adapt without changing their storage contract", () => {
  const waypoint = adaptEditorialGap({
    id: 7,
    title: "Locate the chart",
    description: null,
    kind: "media",
    priority: 1,
    status: "claimed",
    claimed_by: "human@example.test",
    claimed_at: "2026-09-10T10:00:00Z",
  });
  assert.equal(waypoint.type, "image");
  assert.equal(waypoint.status, "taken");
  assert.equal(waypoint.takenBy, "human@example.test");
  assert.equal(waypoint.context.voyage, null);
  assert.equal(waypoint.requestedVoyager, null);
  assert.equal(waypoint.storage, "editorial_gaps");
});

test("context and requested Voyager survive the compatibility adapter", () => {
  const waypoint = adaptEditorialGap({
    id: 18,
    title: "Verify Calecut",
    description: "Check the historical location",
    kind: "waypoint",
    waypoint_type: "map",
    priority: 2,
    status: "open",
    context_type: "voyage_waypoint",
    context_voyage: "vasco-da-gama",
    context_waypoint_seq: 17,
    context_place: "Calecut",
    requested_agent_account_id: 4,
    requested_agent_id: "agent-abc",
    requested_agent_name: "Magellan",
    requested_agent_handle: "magellan",
  });
  assert.equal(waypoint.type, "map");
  assert.deepEqual(waypoint.context, {
    type: "voyage_waypoint", voyage: "vasco-da-gama", waypointSeq: 17, place: "Calecut",
  });
  assert.deepEqual(waypoint.requestedVoyager, {
    accountId: 4, agentId: "agent-abc", name: "Magellan", handle: "magellan",
  });
  assert.equal(legacyKindForWaypointType("source"), "correction");
  assert.equal(legacyKindForWaypointType("map"), "waypoint");
});

test("Chartroom migration is additive, contextual and actor-agnostic", async () => {
  const sql = await read("../supabase/chartroom_waypoints.sql");
  assert.match(sql, /governance_hardening\.sql/,
    "migration must document the migration that supplies claimed_by/claimed_at");
  assert.match(sql, /mcp_write_functions\.sql/);
  assert.match(sql, /mcp_oauth_write_functions\.sql/);
  assert.match(sql, /alter table editorial_gaps/);
  assert.match(sql, /context_voyage text/);
  assert.match(sql, /context_waypoint_seq int/);
  assert.match(sql, /created_by_contributor_id bigint references contributors/);
  assert.match(sql, /initiated_by_contributor_id bigint references contributors/);
  assert.match(sql, /requested_agent_account_id bigint references agent_accounts/);
  assert.match(sql, /create or replace view chartroom_waypoints/);
  assert.match(sql, /create table if not exists chartroom_follows/);
  assert.match(sql, /create or replace function chartroom_take_waypoint/);
  assert.match(sql, /create or replace function chartroom_offer_waypoint/);
  assert.match(sql, /pg_advisory_xact_lock\(p_contributor_id\)/);
  assert.match(sql, /contributor_id bigint not null references contributors/);
  assert.match(sql, /claimed_by_contributor_id = c\.id or claimed_by = c\.handle/,
    "legacy and modern claims must both count against the same contributor quota");
  assert.doesNotMatch(sql, /coalesce\(claimed_by_contributor_id = c\.id, claimed_by = c\.handle\)/,
    "boolean coalesce masks a matching legacy handle when the id comparison is false");
  assert.doesNotMatch(sql, /drop table|rename (?:table|column)/i);
});

test("Voyager offers are association-checked but do not transfer identity", async () => {
  const sql = await read("../supabase/chartroom_waypoints.sql");
  assert.match(sql, /human_agent_links/,
    "association is consulted only to validate whom a human may address an offer to");
  assert.match(sql, /set requested_agent_account_id = p_agent_account_id/);
  assert.match(sql, /initiated_by_contributor_id = p_human_contributor_id/);
  assert.match(sql, /status = 'open'/,
    "an offer must remain open until the Voyager independently claims it");
  assert.match(sql, /action, verdict, findings, carta_version[\s\S]*'offer-waypoint'/);
});

test("both MCP claim lanes enforce a requested Voyager without changing tool signatures", async () => {
  const sql = await read("../supabase/chartroom_waypoints.sql");
  assert.match(sql, /create or replace function mcp_claim_gap\(\s*p_handle text, p_key_hash text, p_gap_id bigint/);
  assert.match(sql, /create or replace function mcp_claim_gap_oauth\(\s*p_contributor_id bigint, p_gap_id bigint/);
  assert.match(sql, /This Waypoint was offered to another Voyager\./);
  assert.match(sql, /reserved\.handle is distinct from p_handle/);
  assert.match(sql, /reserved\.contributor_id is distinct from p_contributor_id/);
});

test("web actors take Waypoints atomically under their own audit identity", async () => {
  const route = await read("../app/api/chartroom/waypoints/route.ts");
  assert.match(route, /dataRpc\("chartroom_take_waypoint"/);
  assert.match(route, /p_actor: `contributor:\$\{contributor\.handle\}`/);
  assert.match(route, /dataRpc\("chartroom_offer_waypoint"/);
  assert.match(route, /createContextWaypoint/);
  assert.match(route, /context_type: "voyage_waypoint"/);
});

test("contextual Contribute is a local entrance to the shared Chartroom", async () => {
  const panel = await read("../components/ContributePanel.tsx");
  assert.match(panel, /Open Waypoints for this stop/);
  assert.match(panel, /Work on this/);
  assert.match(panel, /Ask a Voyager/);
  assert.match(panel, /Raise another question/);
  assert.match(panel, /View this work in The Chartroom/);
  assert.match(panel, /Use an assistant, but submit the work as mine/,
    "assistant fallback must remain distinct from true Voyager delegation");
  assert.match(panel, /its standing receives the credit/,
    "delegated agent work must retain agent standing");
});

test("global Chartroom can focus the same contextual rows", async () => {
  const page = await read("../app/contribute/page.tsx");
  assert.match(page, /chartroom_waypoints\?status=in\.\(open,taken\)/);
  assert.match(page, /context_voyage=eq\./);
  assert.match(page, /context_waypoint_seq=eq\./);
  assert.match(page, /same work surfaced by Contribute in the Atlas/);
});

test("human workspace resolves its own standing, never a legacy agent contributor", async () => {
  const resolver = await read("../lib/humanContributor.ts");
  assert.match(resolver, /contributors\?human_principal_id/);
  assert.doesNotMatch(resolver, /human_agent_links/);
  assert.match(resolver, /agent_accounts\?contributor_id/,
    "legacy human-principal matches must be checked against first-class agent ownership");
  assert.match(resolver, /existing\.find\(\(row: any\) => !agentIds\.has/,
    "an old OAuth agent contributor must not become the human workspace identity");
  assert.match(resolver, /traveler-\$\{suffix\}/,
    "new human contributor handles should be pseudonymous");
  assert.doesNotMatch(resolver, /const base = \(user\.email/,
    "new public contributor handles must not expose the account email");
});

test("account and navigation centre the Chartroom workspace", async () => {
  const panel = await read("../components/AccountPanel.tsx");
  const nav = await read("../lib/nav.ts");
  assert.match(panel, /My Waypoints/);
  assert.match(panel, /My Contributions/);
  assert.match(panel, /Following/);
  assert.match(panel, /My Agents/);
  assert.doesNotMatch(panel, /account is a keyring/i);
  assert.match(nav, /label: "The Chartroom"/);
});

test("MCP keeps legacy tool names while exposing the shared Waypoint contract", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const middleware = await read("../middleware.ts");
  assert.match(route, /name: "list_gaps"/);
  assert.match(route, /name: "claim_gap"/);
  assert.match(route, /waypoints,/);
  assert.match(route, /curated_gaps: rows/);
  assert.match(middleware, /const MODERN = "2026-07-28"/);
  assert.match(middleware, /const LEGACY = "2025-06-18"/);
});

test("publication authority remains absent from agent capabilities", async () => {
  const capabilities = await read("../lib/agentCapabilities.ts");
  assert.match(capabilities, /AGENT_CAN_PUBLISH = false/);
  assert.doesNotMatch(capabilities, /publish:\s*"/);
});
