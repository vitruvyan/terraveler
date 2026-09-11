import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("an unattended agent can self-enrol with client_credentials and no human sponsor", async () => {
  const register = await read("../app/api/oauth/register/route.ts");
  const token = await read("../app/api/oauth/token/route.ts");
  assert.match(register, /wantsCC[\s\S]*client_credentials/,
    "registration must recognise grant_types: [\"client_credentials\"]");
  assert.match(register, /!uris\.length && !wantsCC/,
    "client_credentials registration must not require redirect_uris");
  assert.match(register, /createAgentAccount\(\{[\s\S]*enrollment:\s*"self"/,
    "self-enrolling agents get enrollment: 'self', not a human-assisted one");
  assert.equal(register.includes("human_sponsor"), false,
    "the OAuth registration route must never touch the legacy sponsor field");
  assert.match(token, /grant_type === "client_credentials"/);
  assert.equal(token.includes("human_sponsor"), false,
    "the token endpoint must never touch the legacy sponsor field either");
});

test("agent identity survives the credential that authenticates it", async () => {
  const identity = await read("../lib/agentIdentity.ts");
  const register = await read("../app/api/oauth/register/route.ts");
  assert.match(identity, /publicId = \(\) => `agent_/, "agent_id has its own namespace");
  assert.match(register, /client_id = `tv_/, "client_id has a distinct namespace from agent_id");
  assert.match(register, /agent_id:\s*agent\.public_id/);
  assert.match(register, /client_secret,?\s*$/m,
    "the response separates the durable agent_id from the rotatable client_secret");
});

test("createAgentAccount never fabricates a human_sponsor for an autonomous agent", async () => {
  const identity = await read("../lib/agentIdentity.ts");
  assert.match(identity, /human_sponsor:\s*null/,
    "every agent-created contributor row must record a real absence, not a declaration");
  assert.equal(/autonomous — no human/.test(identity), false,
    "agentIdentity.ts must not synthesize a sponsor string standing in for 'no sponsor'");
});

test("the legacy sponsored register path stays explicit and does not fabricate 'autonomous' as a sponsor", async () => {
  const route = await read("../app/api/mcp/route.ts");
  assert.match(route, /LEGACY 2025-protocol registration/,
    "the register tool description must mark itself legacy, not the general enrollment path");
  assert.match(route, /prefer[\s\S]{0,80}POST \/api\/oauth\/register/,
    "the register tool description must point unattended agents at client_credentials");
  assert.match(route, /human_sponsor is required/,
    "the fully-legacy no-bearer path still enforces a declared sponsor (Carta 10)");
  assert.equal(route.includes("autonomous — no human approved this connection"), false,
    "the server must not fabricate a pseudo-sponsor string for an authenticated autonomous bearer");
  const caseStart = route.indexOf('case "register"');
  assert.ok(caseStart >= 0, "register tool handler not found");
  const bearerBranchStart = route.indexOf("if (bearer)", caseStart);
  assert.ok(bearerBranchStart >= 0, "bearer branch of register not found");
  const bearerBranch = route.slice(bearerBranchStart, bearerBranchStart + 2000);
  assert.match(bearerBranch, /createAgentAccount|ensureAgentForConnection/,
    "an authenticated connection claiming a handle must go through the canonical agent_accounts model");
  assert.equal(/human_sponsor:/.test(bearerBranch), false,
    "the bearer branch of register must not write to the legacy sponsor field at all");
});

test("MCP discovery tells a cold agent that unattended enrollment needs no human", async () => {
  const middleware = await read("../middleware.ts");
  const capabilities = await read("../app/api/agent/capabilities/route.ts");
  assert.match(middleware, /client_credentials/);
  assert.match(middleware, /human_required:\s*false/);
  assert.match(middleware, /human_required:\s*true/);
  assert.match(middleware, /\/api\/oauth\/register/);
  assert.match(capabilities, /unattended_agent:\s*\{/);
  assert.match(capabilities, /method:\s*"oauth_client_credentials"/);
  assert.match(capabilities, /human_required:\s*false/);
  assert.match(capabilities, /interactive_agent:\s*\{/);
  assert.match(capabilities, /human_required:\s*true/);
});

test("the modern get_contract rewrite is concrete about the autonomous path, not just permissive", async () => {
  const middleware = await read("../middleware.ts");
  const start = middleware.indexOf("function moderniseContract");
  assert.ok(start >= 0, "moderniseContract not found");
  const fn = middleware.slice(start, start + 1600);
  assert.match(fn, /client_credentials/);
  assert.match(fn, /\/api\/oauth\/register/);
  assert.match(fn, /human_required:\s*false/);
  assert.match(fn, /human_required:\s*true/);
});

test("get_contract recommends the autonomous path before the legacy one", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const start = route.indexOf('case "get_contract"');
  assert.ok(start >= 0, "get_contract handler not found");
  const contractSection = route.slice(start, start + 2500);
  assert.match(contractSection, /grant_types["\s\S]*client_credentials/);
  const autonomousIdx = contractSection.indexOf("client_credentials");
  const legacyIdx = contractSection.indexOf("Legacy 2025 protocol only");
  assert.ok(autonomousIdx >= 0 && legacyIdx >= 0 && autonomousIdx < legacyIdx,
    "get_contract must present the autonomous OAuth path before the legacy sponsored one");
});
