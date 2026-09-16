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

test("get_contract exposes OAuth onboarding without a legacy registration secret", async () => {
  const route = await read("../app/api/mcp/route.ts");
  const start = route.indexOf('case "get_contract"');
  assert.ok(start >= 0, "get_contract handler not found");
  const contractSection = route.slice(start, start + 2500);
  assert.match(contractSection, /grant_types["\s\S]*client_credentials/);
  assert.match(contractSection, /Public onboarding is OAuth-only/);
  assert.doesNotMatch(contractSection, /registration_token: \$\{registrationToken\(\)\}/,
    "the public Carta must not mint or disclose a legacy registration secret");
});

// Pinned from a real production incident: an external agent retried
// POST /api/oauth/register every 21-96 seconds against a closed enrollment
// gate for over twenty minutes, ignoring the advisory Retry-After: 300 the
// server already sent. A 503 with nothing but a header behind it gives an
// agent that does not parse Retry-After no reason to slow down.
test("register backs the enrollment-closed Retry-After with a real limit, not just an advisory header", async () => {
  const register = await read("../app/api/oauth/register/route.ts");
  const gateStart = register.indexOf("!externalAgentEnrollmentEnabled()");
  assert.ok(gateStart >= 0, "enrollment gate check not found");
  const gateBranch = register.slice(gateStart, gateStart + 1800);
  assert.match(gateBranch, /enforceLimits\("oauth-register-closed-gate"/,
    "a repeat hit against the closed gate must consume a real rate limit, not just read an advisory header");
  assert.match(gateBranch, /status:\s*429/,
    "retrying faster than Retry-After while the gate is closed must escalate to 429");
  assert.match(gateBranch, /not an error in your request/,
    "the message must tell a retrying agent this is not a fault in its own request");
  assert.match(gateBranch, /Retry-After/);
});

test("anonymous get_capabilities tells an agent not to attempt register while enrollment is disabled", async () => {
  const capabilities = await read("../app/api/agent/capabilities/route.ts");
  const nextStart = capabilities.indexOf("next: enrollmentEnabled");
  assert.ok(nextStart >= 0, "the conditional `next` guidance was not found");
  const nextBranch = capabilities.slice(nextStart, nextStart + 600);
  assert.match(nextBranch, /do not call POST \/api\/oauth\/register yet/);
  assert.match(nextBranch, /not an error in your request/);
});

test("MCP instructions tell an agent to check enrollment_enabled before calling register", async () => {
  const middleware = await read("../middleware.ts");
  const instrStart = middleware.indexOf("const INSTRUCTIONS =");
  assert.ok(instrStart >= 0, "INSTRUCTIONS constant not found");
  const instructions = middleware.slice(instrStart, instrStart + 1800);
  assert.match(instructions, /enrollment_enabled BEFORE calling register/);
  assert.match(instructions, /obey its Retry-After exactly/);

  const contractStart = middleware.indexOf("function moderniseContract");
  const contractFn = middleware.slice(contractStart, contractStart + 2400);
  assert.match(contractFn, /check enrollment_enabled/);
  assert.match(contractFn, /obey its ["\s+]*Retry-After exactly/);
});
