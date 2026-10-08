import test from "node:test";
import assert from "node:assert/strict";
import { checkSources, correctedDraft, redact, runAudit, toolData } from "../scripts/test_mcp_pipeline.mjs";
import { stage0 } from "../lib/gate";

test("redaction removes credentials even in nested data and echoed strings", () => {
  const secret = "sensitive-test-value";
  const output = JSON.stringify(redact({ client_secret: secret, nested: [
    { access_token: "token-value", authorization: "Bearer header-value" },
    { error_description: `Echoed ${secret}`, note: "Bearer other-token" },
  ], agent_id: "agent_public" }, [secret]));
  for (const value of [secret, "token-value", "header-value", "other-token"])
    assert.ok(!output.includes(value));
  assert.ok(output.includes("agent_public"));
});

test("MCP errors are failures even when HTTP is successful", () => {
  assert.throws(() => toolData({ status: 200, data: { result: { isError: true,
    structuredContent: { valid: true } } } }, "fixture"), /MCP tool error/);
  assert.throws(() => toolData({ status: 200, data: { error: { code: -32602 } } }, "fixture"), /JSON-RPC error/);
});

const quote = correctedDraft.waypoints[0].claims[0].evidence.quote;
async function sourceFetch(input: Parameters<typeof fetch>[0]) {
  const url = input instanceof Request ? input.url : String(input);
  if (url.endsWith(".txt")) return new Response(`Introduction\n${quote}\nConclusion`, { headers: { "Content-Type": "text/plain" } });
  if (url.endsWith(".jpg") && url.includes("upload.wikimedia.org")) return new Response(new Uint8Array([255, 216, 255]),
    { headers: { "Content-Type": "image/jpeg" } });
  return new Response("<p>Public domain</p>", { headers: { "Content-Type": "text/html" } });
}

test("source checks reject the old paraphrase and missing image", async () => {
  const badQuote = structuredClone(correctedDraft);
  badQuote.waypoints[0].claims[0].evidence.quote = "The Governor then departed for Motux, where he remained four days to rest his people and horses.";
  await assert.rejects(checkSources(badQuote, sourceFetch), /quotation absent/);
  await assert.rejects(checkSources(correctedDraft, async (input) =>
    String(input).includes("upload.wikimedia.org") ? new Response("Not found", { status: 404 }) : sourceFetch(input)), /plate file unavailable/);
  await assert.rejects(checkSources(correctedDraft, async (input) =>
    String(input).includes("commons.wikimedia.org/wiki/") ? new Response("Not found", { status: 404 }) : sourceFetch(input)), /plate record unavailable/);
  assert.equal((await checkSources(correctedDraft, sourceFetch)).length, 2);
});

function mockedServer() {
  const calls: Array<{ name: string; authenticated: boolean }> = [];
  let submitted = false;
  return {
    calls,
    async fetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/mcp")) return sourceFetch(url);
      const request = JSON.parse(init?.body as string);
      const name = request.params.name;
      const authenticated = !!(init?.headers as Record<string, string>)?.Authorization;
      calls.push({ name, authenticated });
      const json = (result: unknown, status = 200, headers = {}) => new Response(JSON.stringify({
        jsonrpc: "2.0", id: request.id, result }), { status, headers: { "Content-Type": "application/json", ...headers } });
      if (name === "get_capabilities") return json({ structuredContent: {
        allowed: authenticated ? ["read", "contribute", "review"] : ["read"],
        publish: false, ...(authenticated ? { agent_id: "agent_fixture", voyager_name: "nellie-bly" } : {}),
      } });
      if (name === "validate_draft") {
        const failures = stage0(request.params.arguments.submission);
        return json({ structuredContent: { valid: !failures.length, gate_failures: failures } });
      }
      if (name === "submit_draft" && !authenticated) return json({ isError: true }, 401, { "WWW-Authenticate": "Bearer realm=\"Terraveler\"" });
      if (name === "suggest_content") return json({ structuredContent: { status: "human-review", submission_id: 201 } });
      if (name === "submit_draft") {
        if (submitted) return json({ isError: true, content: [{ type: "text", text: "ERROR: DUPLICATE_SUBMISSION: identical content already exists as submission #202" }] });
        submitted = true;
        return json({ structuredContent: { status: "peer-review", submission_id: 202 } });
      }
      throw new Error(`Unexpected mocked call ${name}`);
    },
  };
}

test("default probe verifies gates without registering an agent or making authenticated writes", async () => {
  const server = mockedServer();
  const result = await runAudit({ fetchImpl: server.fetch });
  assert.equal(result.ok, true);
  assert.equal(result.writes_enabled, false);
  assert.deepEqual(server.calls.filter((c) => c.name !== "get_capabilities" && c.name !== "validate_draft"),
    [{ name: "submit_draft", authenticated: false }]);
  assert.equal(result.checks.length, 6);
  assert.ok(result.pending.includes("deep Curator verification"));
});

test("write mode needs an existing token and exercises the duplicate rejection", async () => {
  await assert.rejects(runAudit({ write: true }), /requires TERRAVELER_AGENT_TOKEN/);
  const server = mockedServer();
  const result = await runAudit({ write: true, token: "test-token", fetchImpl: server.fetch });
  assert.equal(result.ok, true);
  assert.equal(server.calls.filter((c) => c.name === "submit_draft" && c.authenticated).length, 2);
  assert.equal(result.checks.at(-1)?.submission_id, 202);
});

test("write failure retains confirmed submission receipts for status checks before any retry", async () => {
  const server = mockedServer();
  const receipts: Array<{kind: string; submission_id: number}> = [];
  await assert.rejects(runAudit({ write: true, token: "test-token", onReceipt: (r) => receipts.push(r),
    fetchImpl: async (input, init) => {
      const request = init?.body ? JSON.parse(init.body as string) : null;
      if (request?.params?.name === "submit_draft" && (init?.headers as Record<string,string>)?.Authorization)
        throw new Error("simulated network failure before confirmation");
      return server.fetch(input, init);
    } }), /simulated network failure/);
  assert.deepEqual(receipts, [{ kind: "ethnography suggestion", submission_id: 201 }]);
});
