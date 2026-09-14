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
  // Phase 5 write-authority audit: this was a second, hand-typed copy of
  // TOOL_SCOPE (const SCOPE_FOR = {...9 literal entries...}), pinned equal to
  // the import by a regex here. Two literals that happen to match is exactly
  // the shape drift takes the day someone edits one and not the other — so
  // the fix was to delete the second literal, not add a third check. This
  // now pins the STRUCTURAL guarantee that replaced the regex: one map,
  // imported, never retyped.
  const route = await read("../app/api/mcp/route.ts");
  const importsFromAgentCapabilities = route.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/agentCapabilities"/);
  assert.ok(importsFromAgentCapabilities, "route must import from @/lib/agentCapabilities");
  for (const name of ["RANK_QUOTA", "TOOL_SCOPE"]) {
    assert.match(importsFromAgentCapabilities![1], new RegExp(`\\b${name}\\b`), `must import ${name}`);
  }
  assert.match(route, /const SCOPE_FOR: Record<string, Scope \| undefined> = TOOL_SCOPE;/);
  assert.equal(/const SCOPE_FOR[^=]*=\s*\{/.test(route), false,
    "SCOPE_FOR must be the imported TOOL_SCOPE, not a re-declared object literal");
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
  // Phase 5 write-authority audit: the legacy route used to retype every
  // rank's numbers a second time (camelCase, next to this file's
  // snake_case) — pinned equal here by a regex per rank. Derived from
  // RANK_QUOTA now, so there is exactly one number for a rank's quota in
  // the codebase; this pins that derivation, not a second copy of it.
  const route = await read("../app/api/mcp/route.ts");
  assert.match(route,
    /const QUOTA: Record<string, \{ submissionsPerDay: number; activeClaims: number \}> =\s*\n\s*Object\.fromEntries\(Object\.entries\(RANK_QUOTA\)/,
    "QUOTA must be derived from RANK_QUOTA, not a second hand-typed table");
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
