import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("modern protected writes use OAuth identity, not legacy api-key RPCs", async () => {
  const middleware = await read("../middleware.ts");
  const writer = await read("../app/api/agent/write/route.ts");
  for (const tool of [
    "claim_gap", "propose_idea", "submit_draft",
    "suggest_feature", "suggest_content", "submit_review",
  ]) assert.ok(middleware.includes(`"${tool}"`), `${tool} missing from modern write routing`);
  assert.match(middleware, /MODERN_NATIVE_WRITES\.has\(name\).*modernWrite/s);
  assert.match(writer, /verifyBearer\(req\)/);
  assert.match(writer, /bearer\.contributor_id/);
  assert.equal(writer.includes("args.api_key"), false);
  assert.equal(writer.includes("args.handle"), false);
});

test("OAuth-native database functions preserve the transactional write boundary", async () => {
  const sql = await read("../supabase/mcp_oauth_write_functions.sql");
  for (const fn of [
    "mcp_record_submission_oauth",
    "mcp_claim_gap_oauth",
    "mcp_submit_review_oauth",
  ]) assert.match(sql, new RegExp(`create or replace function ${fn}\\(`));
  assert.match(sql, /from mcp_contributor\(p_contributor_id\)/);
  assert.match(sql, /for update/,
    "peer-review advancement must retain its row lock under concurrent reviews");
});

test("modern transport rejects header/body routing disagreement", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /-32020/);
  assert.match(middleware, /Mcp-Method does not match the JSON-RPC body/);
  assert.match(middleware, /Mcp-Name does not match the JSON-RPC body/);
  assert.match(middleware, /protocolVersion/);
});

test("modern unauthorised protected tools surface a real HTTP challenge", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /payload\?\.result\?\._meta\?\.\["mcp\/www_authenticate"\]/);
  assert.match(middleware, /challenge && payload\?\.result\?\.isError && upstream\.status === 200/);
  assert.match(middleware, /\? 401\s*:\s*upstream\.status/);
});

test("the modern Carta never sends an OAuth client back to legacy registration", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /moderniseContract/);
  assert.match(middleware, /do not call register and do not ask a human for an API key/);

  const skill = await read("../public/skill.md");
  const guide = await read("../docs/HOW_IT_WORKS.md");
  assert.match(skill, /legacy\s+compatibility lane/);
  assert.match(guide, /no API key to paste into the conversation/);
  assert.equal(skill.includes("## 3. Register once"), false);
});

test("tool-list cache hints are explicit on the modern path", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /ttlMs:\s*300_000/);
  assert.match(middleware, /cacheScope:\s*"public"/);
});
