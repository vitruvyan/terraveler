import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const route = readFileSync(join(root, "app/api/mcp/route.ts"), "utf8");
const probe = readFileSync(join(root, "scripts/probe_mcp.mjs"), "utf8");

test("core atlas tools publish output schemas and structured results", () => {
  for (const name of ["search_atlas", "get_voyage", "get_place", "get_context_events"]) {
    const definition = route.slice(route.indexOf(`{ name: "${name}"`));
    assert.match(definition.slice(0, 1400), /outputSchema:/, `${name} should advertise outputSchema`);
  }
  assert.match(route, /structuredContent = parsed/);
  assert.match(route, /content: \[\{ type: "text", text \}\]/);
});

test("public input schemas reject undeclared fields without deleting the legacy bridge", () => {
  assert.match(route, /additionalProperties: false/);
  assert.match(route, /invalidPublicArguments/);
  assert.match(route, /allowed\.add\("handle"\)/);
  assert.match(route, /allowed\.add\("api_key"\)/);
  assert.match(route, /rpcError\(id, -32602, argumentError\)/);
});

test("the probe is read-only and discovers relational identifiers", () => {
  assert.match(probe, /const slug = voyageHit\.voyage/);
  assert.doesNotMatch(probe, /name:\s*"(?:claim_gap|propose_idea|submit_draft|suggest_feature|suggest_content|suggest_source|submit_review|appeal)"/);
  assert.match(probe, /sha256/);
  assert.match(probe, /structuredContent is missing/);
  assert.match(probe, /application\/json, text\/event-stream/);
  assert.match(probe, /"mcp-protocol-version": protocolVersion/);
});
