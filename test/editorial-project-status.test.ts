import test from "node:test";
import assert from "node:assert/strict";
process.env.POSTGREST_URL = "https://data.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";

test("MCP proposal status shows canonical continuity without inventing claim authority", async () => {
  const { POST } = await import("../app/api/mcp/route");
  const old = globalThis.fetch;
  let state: "linked" | "unlinked" | "unavailable" = "linked";
  globalThis.fetch = async input => {
    const url = new URL(String(input)), table = url.pathname.split("/").at(-1);
    if (table === "audit_log") return Response.json([]);
    if (table === "submissions") return Response.json([{ id: 111, type: "idea", status: "approved", contributor_id: 8 }]);
    if (table === "editorial_topic_submissions") return Response.json([{ topic_id: 1, submission_id: 111 }]);
    if (table === "editorial_project_bridges") {
      if (state === "unavailable") throw Error("PRIVATE DATABASE CREDENTIALS");
      return Response.json(state === "unlinked" ? [] : [{ topic_id: 1, gap_id: 24 }]);
    }
    if (table === "editorial_gaps") return Response.json([{ id: 24, title: "Public work", description: "Candidate research",
      kind: "voyage", status: "open", source_submission_id: 111,
      objective: "PRIVATE DOSSIER", lease_token: "PRIVATE CAPABILITY", result: "PRIVATE DRAFT" }]);
    throw Error(`Unexpected table ${table}`);
  };
  async function call() {
    const response = await POST(new Request("https://www.terraveler.com/api/mcp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_submission_status", arguments: { id: 111 } } }),
    }));
    const body = await response.json();
    assert.equal(body.result.isError, false);
    return body.result.structuredContent;
  }
  try {
    const linked = await call();
    assert.equal(linked.project_lookup_state, "linked");
    assert.equal(linked.project.topic_id, 1); assert.equal(linked.project.gap_id, 24);
    assert.equal(linked.publication.published, false);
    assert.ok(!linked.workflow.allowed_actions.includes("claim_gap"));
    assert.doesNotMatch(JSON.stringify(linked), /PRIVATE/);
    state = "unlinked"; const unlinked = await call();
    assert.equal(unlinked.project_lookup_state, "unlinked"); assert.equal(unlinked.project, null);
    assert.deepEqual(unlinked.workflow, linked.workflow);
    state = "unavailable"; const unavailable = await call();
    assert.equal(unavailable.project_lookup_state, "unavailable"); assert.equal(unavailable.project, null);
    assert.deepEqual(unavailable.workflow, linked.workflow);
    assert.doesNotMatch(JSON.stringify(unavailable), /PRIVATE DATABASE/);
  } finally { globalThis.fetch = old; }
});
