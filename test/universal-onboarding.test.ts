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
    "autonomous client_credentials exists in the token endpoint and must be discoverable");
  assert.match(metadata, /token_endpoint_auth_methods_supported:[^\n]*client_secret_post/,
    "autonomous clients authenticate with client_secret_post");
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
