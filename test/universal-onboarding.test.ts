import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("MCP serves modern discovery without removing the legacy era", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /server\/discover/);
  assert.match(middleware, /2026-07-28/);
  assert.match(middleware, /2025-06-18/);
  assert.match(middleware, /supportedVersions:\s*\[MODERN, LEGACY\]/);
  assert.match(middleware, /io\.modelcontextprotocol\/serverInfo/);
  assert.match(middleware, /matcher:\s*\["\/api\/mcp"\]/);
});

test("authorization metadata tells clients what the token endpoint actually supports", async () => {
  const metadata = await read("../app/.well-known/oauth-authorization-server/route.ts");
  assert.match(metadata, /grant_types_supported:[^\n]*client_credentials/,
    "self-enrolled agent client_credentials must be discoverable");
  assert.match(metadata, /token_endpoint_auth_methods_supported:[^\n]*client_secret_post/,
    "self-enrolled agent credentials authenticate with client_secret_post");
  assert.match(metadata, /authorization_response_iss_parameter_supported:\s*true/,
    "RFC 9207 support must be advertised when the callback sends iss");
});

test("every browser authorization response carries the RFC 9207 issuer", async () => {
  const approve = await read("../app/api/oauth/approve/route.ts");
  assert.match(approve, /const ISSUER = "https:\/\/www\.terraveler\.com"/);
  const occurrences = approve.match(/iss:\s*ISSUER/g) ?? [];
  assert.ok(occurrences.length >= 2,
    "both approval and refusal redirects must identify the authorization server");
});

test("connect copy describes hosts rather than privileging one model vendor", async () => {
  const panel = await read("../components/ConnectPanel.tsx");
  const page = await read("../app/connect/page.tsx");
  assert.match(panel, /Gemini CLI/);
  assert.match(panel, /ChatGPT \/ OpenAI/);
  assert.match(panel, /Any MCP client/);
  assert.match(panel, /https:\/\/www\.terraveler\.com\/api\/mcp/);
  assert.equal(page.includes("today that is Claude"), false);
  assert.match(page, /does not maintain a model allowlist/);
});

test("human and agent identities are first-class and independent in the schema", async () => {
  const migration = await read("../supabase/agent_identity.sql");
  assert.match(migration, /create table if not exists agent_accounts/);
  assert.match(migration, /contributor_id bigint not null unique references contributors\(id\)/,
    "one persistent agent must own exactly one standing-bearing contributor");
  assert.match(migration, /create table if not exists human_agent_links/,
    "human-agent association must be its own relation");
  assert.match(migration, /agent_account_id bigint references agent_accounts\(id\)/,
    "connections must be able to bind to the durable agent identity");
  assert.match(migration, /Removing the link does not delete, revoke[\s\S]*standing/,
    "association must not own the agent or its reputation");
});

test("modern capability bootstrap never derives standing from a human principal", async () => {
  const route = await read("../app/api/agent/capabilities/route.ts");
  assert.match(route, /ensureAgentForBearer/);
  assert.equal(route.includes("contributors?human_principal_id"), false,
    "human identity must not select the contributor whose standing an agent uses");
  assert.match(route, /agent_id:\s*agent\.public_id/);
  assert.match(route, /human_linked:/,
    "human association may be reported, but only as association metadata");
});

test("self-enrolled agents get a durable identity distinct from OAuth credentials", async () => {
  const register = await read("../app/api/oauth/register/route.ts");
  const token = await read("../app/api/oauth/token/route.ts");
  assert.match(register, /createAgentAccount/);
  assert.match(register, /agent_account_id:\s*agent\?\.id/);
  assert.match(register, /agent_id:\s*agent\.public_id/);
  assert.match(token, /agent_account_id,client_name,operator/);
  assert.match(token, /agent_account_id:\s*agent\.id/);
  assert.match(token, /contributor_id:\s*agent\.contributor_id/);
  assert.match(token, /agent_id:\s*agent\.public_id/);
});

test("human consent associates an agent instead of making it act as the human", async () => {
  const page = await read("../app/oauth/authorize/page.tsx");
  const approve = await read("../app/api/oauth/approve/route.ts");
  assert.equal(page.includes("contribute to Terraveler as you"), false);
  assert.match(page, /keeps[\s\S]*human identity separate from the agent/);
  assert.match(page, /own persistent[\s\S]*standing/);
  assert.match(approve, /ensureAgentForConnection/);
  assert.match(approve, /humanPrincipalId:\s*principal\.id/);
  assert.match(approve, /action:\s*"associate-agent"/);
});

test("model and runtime are provenance, never the durable identity", async () => {
  const middleware = await read("../middleware.ts");
  const identity = await read("../lib/agentIdentity.ts");
  assert.match(middleware, /standing belongs to the agent, not to a human account, model or runtime/);
  assert.equal(identity.includes("model:"), false,
    "agent account creation must not key identity off a model name");
});
