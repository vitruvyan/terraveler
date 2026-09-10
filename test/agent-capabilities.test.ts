import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AGENT_CAN_PUBLISH,
  LEGACY_ONLY_TOOLS,
  RANK_QUOTA,
  TOOL_SCOPE,
  allowedCapabilities,
  deniedCapabilities,
} from "../lib/agentCapabilities";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("publication is never an agent capability", () => {
  assert.equal(AGENT_CAN_PUBLISH, false);
  assert.equal(allowedCapabilities(["contribute", "review", "appeal"]).includes("publish"), false);
  assert.ok(deniedCapabilities(["contribute", "review", "appeal"]).includes("publish"));
});

test("modern capability scopes stay aligned with legacy runtime enforcement", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const map = route.match(/const SCOPE_FOR[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(map, "legacy SCOPE_FOR not found");
  const legacy = Object.fromEntries(
    [...map[1].matchAll(/^\s*([a-z_]+):\s*"(\w+)"/gm)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(legacy, TOOL_SCOPE,
    "modern policy and legacy enforcement must not silently diverge during migration");
});

test("modern catalogue hides conversation-carried credential mechanics", async () => {
  const middleware = await read("../middleware.ts");
  assert.deepEqual([...LEGACY_ONLY_TOOLS].sort(), ["register", "rotate_key"]);
  assert.match(middleware, /delete properties\.handle/);
  assert.match(middleware, /delete properties\.api_key/);
  assert.match(middleware, /LEGACY_ONLY_TOOLS\.has/);
  assert.match(middleware, /get_capabilities/);
});

test("rank quota mirror is pinned to the product policy", async () => {
  assert.deepEqual(RANK_QUOTA["cabin-boy"], { submissions_per_day: 3, active_claims: 1 });
  assert.deepEqual(RANK_QUOTA.admiral, { submissions_per_day: 48, active_claims: 8 });
  const route = await read("../app/api/mcp/route.ts");
  for (const [rank, q] of Object.entries(RANK_QUOTA)) {
    const pattern = new RegExp(`"${rank.replace("-", "\\-")}"?:?\\s*\\{\\s*submissionsPerDay:\\s*${q.submissions_per_day},\\s*activeClaims:\\s*${q.active_claims}`);
    assert.match(route, pattern, `${rank} quota drifted between legacy enforcement and capability introspection`);
  }
});

test("authenticated modern calls bootstrap a persistent agent before enforcement", async () => {
  const middleware = await read("../middleware.ts");
  const route = await read("../app/api/agent/capabilities/route.ts");
  const identity = await read("../lib/agentIdentity.ts");
  assert.match(middleware, /TOOL_SCOPE\[name\].*authorization/s);
  assert.match(route, /ensureAgentForBearer\(bearer\)/);
  assert.match(identity, /agent_connections\?id=eq\.\$\{c\.connectionId\}/);
  assert.match(identity, /agent_account_id:\s*agent\.id/);
  assert.equal(identity.includes("contributors?human_principal_id"), false,
    "standing must never be selected from the associated human account");
});
