import test from "node:test";
import assert from "node:assert/strict";
process.env.POSTGREST_URL = "https://data.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
const id = "00000000-0000-4000-8000-000000000001";

test("MCP records server-fetched snapshots, rejects caller receipts, and fails closed on enabled storage failure", async () => {
  const { POST } = await import("../app/api/mcp/route");
  const { resetRegistryCache } = await import("../lib/sourceSearch");
  const old = globalThis.fetch, oldFlag = process.env.EDITORIAL_MCP_RECEIPTS_ENABLED;
  let fail = false, writes = 0, sourceReads = 0;
  process.env.EDITORIAL_MCP_RECEIPTS_ENABLED = "1";
  resetRegistryCache();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/source_endpoints")) return Response.json([{ id: 1, institution_id: 1, host_pattern: "en.wikipedia.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" }]);
    if (url.pathname.endsWith("/source_policy_decisions")) return Response.json([{ id: 1, endpoint_id: 1, decision_outcome: "approve", rights_class: "creative_commons" }]);
    if (url.hostname === "en.wikipedia.org") { sourceReads++; return Response.json({ parse: { title: "Example", revid: 123, sections: [{ index: "1", level: "2", line: "Itinerary", anchor: "Itinerary" }], externallinks: [], text: { "*": "<p>Actual MCP source text.</p>" } } }); }
    if (url.pathname.endsWith("/rpc/editorial_record_mcp_consultation")) {
      writes++; const body = JSON.parse(String(init?.body));
      assert.equal(body.p_tool, "get_wikipedia_outline");
      const snapshot = JSON.parse(body.p_response_text);
      assert.match(snapshot.text, /Actual MCP source text/); assert.equal(snapshot.revision_id, 123);
      assert.equal(snapshot.consultation, undefined);
      assert.equal(body.p_arguments.url, snapshot.requested_url);
      if (fail) return new Response("PRIVATE STORAGE DETAIL", { status: 503 });
      return Response.json({ id, response_sha256: "a".repeat(64), arguments_sha256: "b".repeat(64), created_at: "2026-11-16T21:00:00Z" });
    }
    throw Error("Unexpected request " + url.pathname);
  };
  const req = (args: unknown) => new Request("http://local/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_wikipedia_outline", arguments: args } }) });
  try {
    const body = await (await POST(req({ url: "https://en.wikipedia.org/wiki/Example" }))).json();
    assert.equal(body.result.isError, false); assert.equal(body.result.structuredContent.consultation.id, id);
    assert.equal(body.result.structuredContent.consultation_status,"recorded");
    const forged = await (await POST(req({ url: "https://en.wikipedia.org/wiki/Example", consultation: { id } }))).json();
    assert.equal(forged.error.code, -32602); assert.equal(writes, 1); assert.equal(sourceReads,1);
    fail = true;
    const failed = await (await POST(req({ url: "https://en.wikipedia.org/wiki/Example" }))).json();
    assert.equal(failed.result.isError, true); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE STORAGE/);
    assert.equal(failed.result.structuredContent,undefined);
    delete process.env.EDITORIAL_MCP_RECEIPTS_ENABLED;
    const unrecorded = await (await POST(req({ url: "https://en.wikipedia.org/wiki/Example" }))).json();
    assert.equal(unrecorded.result.isError,false);
    assert.equal(unrecorded.result.structuredContent.consultation,null);
    assert.equal(unrecorded.result.structuredContent.consultation_status,"disabled");
    assert.equal(writes,2);
  } finally { globalThis.fetch = old; resetRegistryCache(); if (oldFlag === undefined) delete process.env.EDITORIAL_MCP_RECEIPTS_ENABLED; else process.env.EDITORIAL_MCP_RECEIPTS_ENABLED = oldFlag; }
});


test("raw-text retention denies per-item sources and seed overrides with mixed, unknown or revoked rights", async () => {
  const { sourceTextRetentionAllowed, ensureRegistry, resetRegistryCache, setRegistryRequiredForTest } = await import("../lib/sourceSearch");
  const old = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Unexpected external network access"); };
  try {
    resetRegistryCache(); setRegistryRequiredForTest(false);
    assert.equal(await sourceTextRetentionAllowed("https://archive.org/download/example/book.txt"), false, "archive seed requires per-item verification");
    assert.equal(await sourceTextRetentionAllowed("https://en.wikipedia.org/wiki/Example"), true, "known CC seed permits retention when no live registry is expected");
    for (const scenario of [
      {rights:"mixed",status:"active",mode:"domain_trusted",outcome:"approve"},
      {rights:"unknown",status:"active",mode:"domain_trusted",outcome:"approve"},
      {rights:"creative_commons",status:"quarantined",mode:"domain_trusted",outcome:"approve"},
      {rights:"creative_commons",status:"active",mode:"domain_trusted",outcome:"reject"},
      {rights:"public_domain",status:"active",mode:"item_verified",outcome:"approve"},
      {rights:"in_copyright",status:"active",mode:"domain_trusted",outcome:"approve"},
    ]) {
      resetRegistryCache(); setRegistryRequiredForTest(true);
      await ensureRegistry(Date.now(), async path => path.startsWith("source_endpoints?") ?
        [{id:6,institution_id:3,host_pattern:".wikipedia.org",match_type:"suffix",status:scenario.status,trust_mode:scenario.mode}] :
        [{endpoint_id:6,decision_outcome:scenario.outcome,rights_class:scenario.rights}]);
      assert.equal(await sourceTextRetentionAllowed("https://en.wikipedia.org/wiki/Example"), false, JSON.stringify(scenario));
    }
    resetRegistryCache(); setRegistryRequiredForTest(true);
    await ensureRegistry(Date.now(), async path => path.startsWith("source_endpoints?") ?
      [{id:6,institution_id:3,host_pattern:".wikipedia.org",match_type:"suffix",status:"active",trust_mode:"domain_trusted"}] :
      [{endpoint_id:6,decision_outcome:"approve",rights_class:"creative_commons"}]);
    assert.equal(await sourceTextRetentionAllowed("https://en.wikipedia.org/wiki/Example"), true);
  } finally { globalThis.fetch=old; resetRegistryCache(); setRegistryRequiredForTest(true); }
});

test("retained source reads recheck rights at redirects before fetching the destination", async () => {
  const { getGovernedText, resetRegistryCache, setRegistryRequiredForTest } = await import("../lib/sourceSearch");
  resetRegistryCache(); setRegistryRequiredForTest(false);
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input); calls.push(url);
    if (url === "https://www.gutenberg.org/cache/epub/1/pg1.txt")
      return new Response(null, {status:302,headers:{location:"https://archive.org/download/example/book.txt"}});
    throw Error("The item-verified redirect destination must never be fetched");
  };
  try {
    await assert.rejects(getGovernedText("https://www.gutenberg.org/cache/epub/1/pg1.txt", fetcher as typeof fetch, true), /retention|retaining|raw.text|storage/i);
    assert.deepEqual(calls, ["https://www.gutenberg.org/cache/epub/1/pg1.txt"]);
  } finally {resetRegistryCache();setRegistryRequiredForTest(true);}
});
