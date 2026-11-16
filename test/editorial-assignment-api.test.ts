import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
test("specialist assignment is editor-only, typed and idempotent at the database boundary", async () => {
 const { POST } = await import("../app/api/desk/projects/assign/route");
 const old = globalThis.fetch; let calls = 0;
 globalThis.fetch = async (url, init) => {
  if (String(url).includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
  assert.match(String(url), /rpc\/editorial_assign_specialist$/); calls++;
  assert.deepEqual(JSON.parse(String(init?.body)), { p_task_id: 1, p_agent_key: "historian-a", p_specialty: "history", p_request_id: "assignment-000001" });
  return Response.json({ task_id: 1 });
 };
 const body = { task_id: 1, agent_key: "historian-a", specialty: "history", request_id: "assignment-000001" };
 const request = (v: unknown, cookie = true, origin = "http://local") => new Request("http://local/api/desk/projects/assign", { method: "POST", headers: { ...(cookie ? { cookie: "desk_token=fixture" } : {}), origin }, body: JSON.stringify(v) });
 try {
  assert.equal((await POST(request(body, false))).status, 401);
  assert.equal((await POST(request(body, true, "http://foreign"))).status, 403);
  assert.equal((await POST(request({ ...body, sql: "arbitrary" }))).status, 400);
  assert.equal((await POST(request(body))).status, 200); assert.equal(calls, 1);
 } finally { globalThis.fetch = old; }
});
