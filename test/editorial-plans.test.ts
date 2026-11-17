import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const modules = Promise.all([import("../lib/editorialPlans"), import("../lib/mcpConsultations")]);
const receiptId = "00000000-0000-4000-8000-000000000001";
function request() { return { topic_id: 1, expected_version: 0, request_id: "plan-request-00000001", plan: {
  orientation_receipt_id: receiptId, gaps: ["The itinerary is disputed."],
  work_items: [{ id: "history", question: "Which events are documented?", deliverable: "Cited chronology", specialty: "history", depends_on: [] as string[], source_receipt_ids: [] as string[] },
    { id: "diary", question: "How should the account be composed?", deliverable: "Sourced draft", specialty: "diary", depends_on: ["history"], source_receipt_ids: [receiptId] }],
} }; }

test("plan intake rejects invented consultation assertions and invalid dependency graphs", async () => {
  const [{ parseEditorialPlanRequest: parse }] = await modules;
  assert.deepEqual(parse(request()), request());
  for (const mutate of [
    (v: any) => { v.plan.via_mcp = true; },
    (v: any) => { v.plan.orientation_receipt_id = "agent-says-consulted"; },
    (v: any) => { v.plan.work_items[0].specialty = "publisher"; },
    (v: any) => { v.plan.work_items[0].depends_on = ["diary"]; },
    (v: any) => { v.plan.work_items[0].depends_on = ["missing"]; },
    (v: any) => { v.plan.work_items[0].depends_on = ["history"]; },
    (v: any) => { v.plan.work_items[1].id = "history"; },
    (v: any) => { v.expected_version = -1; },
    (v: any) => { v.plan.work_items[1].source_receipt_ids = [receiptId, receiptId]; },
    (v: any) => { v.plan.work_items[0].question = " "; },
    (v: any) => { v.plan.work_items[0].id = "1invalid"; },
  ]) { const v = request(); mutate(v); assert.equal(parse(v), null); }
});

test("plan save preserves exact intent and version reads are bounded and scoped", async () => {
  const [{ parseEditorialPlanRequest, saveEditorialPlan, readEditorialPlans }] = await modules;
  const value = request(); value.plan.work_items[0].question = "  Preserve this exact intent  ";
  const input = parseEditorialPlanRequest(value); assert.ok(input);
  await saveEditorialPlan(input, async (name, args) => {
    assert.equal(name, "editorial_save_plan");
    assert.deepEqual(args, { p_topic_id: 1, p_expected_version: 0, p_request_id: input.request_id, p_plan: input.plan });
    assert.equal((args.p_plan as typeof value.plan).work_items[0].question, "  Preserve this exact intent  ");
    return { id: 1, version: 1, state: "proposed" };
  });
  const read = await readEditorialPlans(1, 4, async (_method, path) => {
    assert.match(path, /topic_id=eq.1/); assert.match(path, /version=lt.4/);
    assert.match(path, /limit=20/); assert.doesNotMatch(path, /response_text/); return [];
  });
  assert.deepEqual(read, { plans: [], next_before: null });
  await assert.rejects(readEditorialPlans(-1));
  await assert.rejects(readEditorialPlans(1, -1));
});

test("receipt recording is server-enabled and a storage failure cannot become an unrecorded success", async () => {
  const [, { recordMCPConsultation }] = await modules;
  let calls = 0;
  assert.equal(await recordMCPConsultation("fetch_source_text", {}, {}, {}, async () => { calls++; return {}; }), null);
  assert.equal(calls, 0);
  const source = { url: "https://en.wikipedia.org/wiki/Example", kind: "wikipedia", text: "Consulted paragraph.", truncated: false, total_length: 20 };
  const ack = { id: receiptId, response_sha256: "a".repeat(64), arguments_sha256: "b".repeat(64), created_at: "2026-11-16T21:00:00Z" };
  assert.deepEqual(await recordMCPConsultation("fetch_source_text", { url: source.url }, source, { EDITORIAL_MCP_RECEIPTS_ENABLED: "1" }, async (name, args) => {
    assert.equal(name, "editorial_record_mcp_consultation"); assert.equal(args.p_response_text, JSON.stringify(source));
    assert.equal(args.p_tool, "fetch_source_text"); return ack;
  }, async () => true), ack);
  await assert.rejects(recordMCPConsultation("fetch_source_text", { url: source.url }, source,
    { EDITORIAL_MCP_RECEIPTS_ENABLED: "1" }, async () => { calls++; return ack; }, async () => false), /not authorized for raw-text receipt storage/);
  assert.equal(calls, 0, "retention denial must not send source bytes to storage");
  for (const rpc of [async () => { throw Error("PRIVATE DATABASE ERROR"); }, async () => ({...ack, id:"forged-id"})]) {
    await assert.rejects(recordMCPConsultation("fetch_source_text", {}, source, { EDITORIAL_MCP_RECEIPTS_ENABLED: "1" }, rpc, async () => true), error => {
      assert.doesNotMatch(String(error), /PRIVATE/); return /could not be recorded/.test(String(error));
    });
  }
});

test("plan API authenticates and validates before any plan write and keeps replies private", async () => {
  const { GET, POST } = await import("../app/api/desk/projects/plan/route");
  const old = globalThis.fetch; let writes = 0, reads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    if (url.endsWith("/rpc/editorial_save_plan")) { writes++; assert.equal(init?.method, "POST"); return Response.json({ id: 1, version: 1, state: "proposed" }); }
    if (url.includes("/editorial_plans?")) { reads++; return Response.json([]); }
    throw Error("Unexpected data access");
  };
  const req = (body: unknown, origin = "http://local") => new Request("http://local/api/desk/projects/plan", { method: "POST", headers: { cookie: "desk_token=fixture", origin }, body: JSON.stringify(body) });
  try {
    assert.equal((await GET(new Request("http://local/api/desk/projects/plan?topic_id=1"))).status, 401);
    assert.equal((await POST(new Request("http://local/api/desk/projects/plan", {method:"POST",body:JSON.stringify(request())}))).status,401);
    assert.equal((await POST(req(request(), "http://foreign"))).status, 403);
    assert.equal((await POST(req({ ...request(), response_text: "fake MCP read" }))).status, 400);
    assert.equal((await GET(new Request("http://local/api/desk/projects/plan?topic_id=1%26limit=99", {headers:{cookie:"desk_token=fixture"}}))).status,400);
    assert.equal(writes, 0); assert.equal(reads, 0);
    const result = await POST(req(request())); assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control") ?? "", /private, no-store/); assert.equal(writes, 1);
    const read = await GET(new Request("http://local/api/desk/projects/plan?topic_id=1", {headers:{cookie:"desk_token=fixture"}}));
    assert.equal(read.status,200); assert.equal(reads,1);
  } finally { globalThis.fetch = old; }
});
