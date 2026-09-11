import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WAYPOINT_STATUSES,
  WAYPOINT_TYPES,
  adaptEditorialGap,
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
  assert.equal(waypoint.storage, "editorial_gaps");
});

test("Chartroom migration is additive and actor-agnostic", async () => {
  const sql = await read("../supabase/chartroom_waypoints.sql");
  assert.match(sql, /alter table editorial_gaps/);
  assert.match(sql, /create or replace view chartroom_waypoints/);
  assert.match(sql, /create table if not exists chartroom_follows/);
  assert.match(sql, /create or replace function chartroom_take_waypoint/);
  assert.match(sql, /pg_advisory_xact_lock\(p_contributor_id\)/);
  assert.match(sql, /contributor_id bigint not null references contributors/);
  assert.doesNotMatch(sql, /drop table|rename (?:table|column)/i);
});

test("web actors take Waypoints atomically under their own audit identity", async () => {
  const route = await read("../app/api/chartroom/waypoints/route.ts");
  assert.match(route, /dataRpc\("chartroom_take_waypoint"/);
  assert.match(route, /p_actor: `contributor:\$\{contributor\.handle\}`/);
  assert.doesNotMatch(route, /human_agent_links/);
});

test("human workspace resolves standing directly, never through an associated agent", async () => {
  const resolver = await read("../lib/humanContributor.ts");
  assert.match(resolver, /contributors\?human_principal_id/);
  assert.doesNotMatch(resolver, /human_agent_links/);
  assert.match(resolver, /agent_accounts\?contributor_id/,
    "legacy adoption must refuse a contributor that already belongs to an agent");
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
