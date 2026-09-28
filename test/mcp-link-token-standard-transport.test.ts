import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `create_human_link_token` lived only in the envelope-aware lane
 * (middleware.ts, Mcp-Method headers). Standard Streamable-HTTP clients — ChatGPT
 * among them — negotiate 2025-06-18, never reach the middleware, and got
 * "unknown tool" from a server whose own instructions tell them to call it.
 * These pin that the standard route lists and serves it.
 */
const post = async (body: unknown, headers: Record<string, string> = {}) => {
  process.env.POSTGREST_URL = "https://mock-postgrest.example.com";
  process.env.POSTGREST_SERVICE_KEY = "mock-key";
  const { POST } = await import("../app/api/mcp/route");
  return POST(new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  }));
};

test("the standard transport advertises create_human_link_token to any authenticated agent", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const body: any = await res.json();
  const tool = body.result.tools.find((t: any) => t.name === "create_human_link_token");
  assert.ok(tool, "listed");
  assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: [] }], "any authenticated agent, whatever its scopes");
  assert.deepEqual(tool.inputSchema.properties, {}, "takes no arguments — the agent cannot choose the human");
  assert.equal(tool.annotations.destructiveHint, false);
});

test("without a bearer it answers with the OAuth challenge, not 'unknown tool'", async () => {
  const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "create_human_link_token", arguments: {} } });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /Bearer realm="Terraveler".*resource_metadata=/);
  const body: any = await res.json();
  assert.equal(body.result.isError, true);
  assert.ok(Array.isArray(body.result._meta["mcp/www_authenticate"]), "the _meta OpenAI's linking UI reads");
  assert.doesNotMatch(JSON.stringify(body), /unknown tool/i);
});

test("it takes no arguments: a smuggled agent_account_id or human id is refused", async () => {
  const res = await post({ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "create_human_link_token", arguments: { human_principal_id: 1 } } });
  const body: any = await res.json();
  assert.equal(body.error?.code, -32602);
});

test("the envelope-aware lane's copy and this one cannot disagree about the name", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const middleware = readFileSync(join(__dirname, "..", "middleware.ts"), "utf8");
  assert.match(middleware, /name: "create_human_link_token"/);
  const route = readFileSync(join(__dirname, "..", "app/api/mcp/route.ts"), "utf8");
  assert.match(route, /\{ name: "create_human_link_token",/);
  assert.match(route, /return humanLinkToken\(req, id, bearer\)/);
});
