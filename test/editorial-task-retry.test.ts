import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";

const body = { task_id: 11, expected_attempt: 3, request_id: "cabeza-retry-000001", reason: "Provider connectivity restored" };

test("task retry accepts only an explicit bounded editor decision", async () => {
  const { parseRetryTaskRequest, retryEditorialTask } = await import("../lib/editorialDispatch");
  assert.deepEqual(parseRetryTaskRequest(body), body);
  for (const invalid of [null, [], { ...body, task_id: 0 }, { ...body, expected_attempt: 1.5 },
    { ...body, reason: " Provider connectivity restored " }, { ...body, reason: "x".repeat(501) },
    { ...body, reason: "line\nbreak" }, { ...body, request_id: "short" }, { ...body, publish: true }]) {
    assert.equal(parseRetryTaskRequest(invalid), null);
  }
  const calls: unknown[] = [];
  await retryEditorialTask(body, async (name, args) => { calls.push({ name, args }); return { task_id: 11 }; });
  assert.deepEqual(calls, [{ name: "desk_retry_editorial_task", args: {
    p_task_id: 11, p_expected_attempt: 3, p_request_id: body.request_id, p_reason: body.reason,
  } }]);
});

test("task retry API authenticates, checks origin and feature gates, and calls only the governed RPC", async t => {
  const oldFetch = globalThis.fetch;
  const oldDispatch = process.env.EDITORIAL_PLAN_DISPATCH_ENABLED;
  const oldCorpus = process.env.EDITORIAL_MCP_CORPUS_ENABLED;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of [["EDITORIAL_PLAN_DISPATCH_ENABLED", oldDispatch], ["EDITORIAL_MCP_CORPUS_ENABLED", oldCorpus]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    assert.match(String(url), /rpc\/desk_retry_editorial_task$/);
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), { p_task_id: 11, p_expected_attempt: 3, p_request_id: body.request_id, p_reason: body.reason });
    return Response.json({ task_id: 11, run_id: 3, attempt: 3, max_attempts: 4, replayed: false });
  };
  const { POST } = await import("../app/api/desk/projects/retry/route");
  const request = (value: unknown = body, cookie = true, origin = "http://local") => new Request("http://local/api/desk/projects/retry", {
    method: "POST", headers: { ...(cookie ? { cookie: "desk_token=fixture" } : {}), origin }, body: JSON.stringify(value),
  });
  process.env.EDITORIAL_PLAN_DISPATCH_ENABLED = "0";
  process.env.EDITORIAL_MCP_CORPUS_ENABLED = "0";
  assert.equal((await POST(request(body, false))).status, 401);
  assert.equal((await POST(request(body, true, "http://foreign"))).status, 403);
  assert.equal((await POST(request())).status, 503);
  process.env.EDITORIAL_PLAN_DISPATCH_ENABLED = "1";
  process.env.EDITORIAL_MCP_CORPUS_ENABLED = "1";
  assert.equal((await POST(request({ ...body, arbitrary: true }))).status, 400);
  assert.equal(calls, 0);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).max_attempts, 4);
  assert.equal(calls, 1);
});
