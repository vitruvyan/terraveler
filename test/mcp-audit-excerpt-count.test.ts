import { test } from "node:test";
import assert from "node:assert/strict";

test("get_audit counts submitted quotes without claiming rejected quotations are verified", async (t) => {
  const config = {
    POSTGREST_URL: "https://audit-data.example.test",
    POSTGREST_SERVICE_KEY: "fixture-service-key",
  };
  const prior = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const { POST } = await import("../app/api/mcp/route");
  const falseQuote = "Invented fixture quotation that does not appear in the source.";
  const trail = [{ actor: "curator", action: "review", verdict: "rejected",
    findings: [["SOURCE", 0, "Submitted quotation is absent from the source."]],
    carta_version: "0.4", created_at: "2026-10-07T00:00:00Z" }];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, config.POSTGREST_URL);
    assert.equal(init?.method, "GET", "audit introspection must only read application data");
    switch (url.pathname) {
      case "/rest/v1/submissions":
        assert.equal(url.searchParams.get("id"), "eq.109");
        return Response.json([{ id: 109, type: "waypoint-enrichment", status: "curator-rejected",
          target_voyage: "fixture", contributor_id: 7, payload: { waypoints: [
            { claims: [{ evidence: { quote: falseQuote } }, { evidence: { quote: "Another submitted quote." } }] },
            { claims: [{ evidence: { quote: "" } }] },
            { claims: [{ evidence: { source_url: "https://www.gutenberg.org/ebooks/1" } }] },
          ] } }]);
      case "/rest/v1/contributors":
        return Response.json([{ handle: "fixture-scribe", rank: "cabin-boy" }]);
      case "/rest/v1/audit_log":
        return Response.json(trail);
      default: assert.fail(`Unexpected backend request: ${url.pathname}`);
    }
  };
  const response = await POST(new Request("https://app.example.test/api/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "get_audit", arguments: { id: 109 } } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.isError, false, JSON.stringify(body));
  const audit = body.result.structuredContent;
  assert.deepEqual(audit.content, { kind: "draft", waypoints: 3, with_quoted_excerpt: 1 },
    "count waypoints with quotes, not individual quotes or source-only claims");
  assert.equal(Object.hasOwn(audit.content, "with_verified_excerpt"), false);
  assert.equal(audit.submission.status, "curator-rejected");
  assert.deepEqual(audit.trail, trail, "verification findings and verdicts remain separately inspectable");
  assert.match(audit.note, /does not assert source verification or approval/);
  assert.deepEqual(JSON.parse(body.result.content[0].text), audit,
    "text and structured MCP results expose the same accurate metadata");
  assert.equal(JSON.stringify(body).includes(falseQuote), false, "unapproved draft text remains withheld");
});
