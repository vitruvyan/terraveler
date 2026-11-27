import test from "node:test";
import assert from "node:assert/strict";
process.env.POSTGREST_URL = "https://data.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
const id = "00000000-0000-4000-8000-000000000002";
const meta = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
const page = (title: string, licence: Record<string, string>) => ({
  pageid: 101, lastrevid: 9001, title, index: 1,
  imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg", thumburl: null, mime: "image/jpeg",
    width: 800, height: 600, sha1: "b".repeat(40), extmetadata: meta({ ...licence, Artist: "Theodor de Bry", DateTimeOriginal: "1591" }) }],
});

test("Commons tools: candidates are not receipts; a fetched usable file is recorded under its own tool; refused files write nothing", async () => {
  const { POST } = await import("../app/api/mcp/route");
  const { resetRegistryCache } = await import("../lib/sourceSearch");
  const old = globalThis.fetch, oldFlag = process.env.EDITORIAL_MCP_RECEIPTS_ENABLED;
  const writes: any[] = [];
  let pages: unknown[] = [];
  process.env.EDITORIAL_MCP_RECEIPTS_ENABLED = "1";
  resetRegistryCache();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/source_endpoints")) return Response.json([{ id: 7, institution_id: 3, host_pattern: ".wikimedia.org", match_type: "suffix", status: "active", trust_mode: "domain_trusted" }]);
    if (url.pathname.endsWith("/source_policy_decisions")) return Response.json([{ id: 7, endpoint_id: 7, decision_outcome: "approve", rights_class: "mixed" }]);
    if (url.hostname === "commons.wikimedia.org") return Response.json({ query: { pages } });
    if (url.pathname.endsWith("/rpc/editorial_record_mcp_consultation")) {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ id, response_sha256: "a".repeat(64), arguments_sha256: "c".repeat(64), created_at: "2026-11-27T21:00:00Z" });
    }
    throw Error("Unexpected request " + url.href);
  };
  const call = async (name: string, args: unknown) => (await (await POST(new Request("http://local/api/mcp", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }))).json());
  try {
    pages = [page("File:De Bry Florida.jpg", { License: "pd", LicenseShortName: "Public domain" }),
      { ...page("File:Reenactment.jpg", { License: "cc-by-nc-2.0", LicenseShortName: "CC BY-NC 2.0" }), index: 2 }];
    const search = await call("search_commons_images", { query: "Florida 1591 engraving", limit: 5 });
    assert.equal(search.result.isError, false);
    assert.deepEqual(search.result.structuredContent.candidates.map((c: any) => [c.title, c.usable]),
      [["File:De Bry Florida.jpg", true], ["File:Reenactment.jpg", false]]);
    assert.equal(writes.length, 0, "a search never records a consultation");

    pages = [page("File:De Bry Florida.jpg", { License: "pd", LicenseShortName: "Public domain" })];
    const fetched = await call("fetch_commons_image", { title: "File:De Bry Florida.jpg" });
    assert.equal(fetched.result.isError, false);
    assert.equal(fetched.result.structuredContent.consultation_status, "recorded");
    assert.equal(fetched.result.structuredContent.date_year, 1591);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].p_tool, "fetch_commons_image");
    assert.deepEqual(writes[0].p_arguments, { title: "File:De Bry Florida.jpg" });
    const snapshot = JSON.parse(writes[0].p_response_text);
    assert.equal(snapshot.licence.class, "public_domain"); assert.equal(snapshot.consultation, undefined);

    pages = [page("File:Reenactment.jpg", { License: "cc-by-nc-2.0", LicenseShortName: "CC BY-NC 2.0" })];
    const refused = await call("fetch_commons_image", { title: "File:Reenactment.jpg" });
    assert.equal(refused.result.isError, true);
    assert.match(JSON.stringify(refused), /licence-non-commercial/);
    assert.equal(writes.length, 1, "a refused file writes no receipt");

    const unexpected = await call("fetch_commons_image", { title: "File:De Bry Florida.jpg", consultation: { id } });
    assert.equal(unexpected.error.code, -32602);

    process.env.EDITORIAL_MCP_RECEIPTS_ENABLED = "0";
    pages = [page("File:De Bry Florida.jpg", { License: "pd", LicenseShortName: "Public domain" })];
    const disabled = await call("fetch_commons_image", { title: "File:De Bry Florida.jpg" });
    assert.equal(disabled.result.structuredContent.consultation_status, "disabled");
    assert.equal(writes.length, 1);
  } finally {
    globalThis.fetch = old;
    if (oldFlag === undefined) delete process.env.EDITORIAL_MCP_RECEIPTS_ENABLED; else process.env.EDITORIAL_MCP_RECEIPTS_ENABLED = oldFlag;
    resetRegistryCache();
  }
});
