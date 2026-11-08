import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
process.env.EDITORIAL_WORKFLOW_ENABLED = "1";
process.env.EDITOR_LIMEN_BASE_URL = "https://gateway.example.invalid";
process.env.EDITOR_LIMEN_API_KEY = "private-key";
process.env.EDITOR_LIMEN_DATA_CLASS = "editorial";
const route = import("../app/api/desk/projects/chat/route");
const body = { topic_id: 1, message: "Please consolidate the research", request_id: "request-00000001" };
function request(cookie = true) { return new Request("http://local/api/desk/projects/chat", { method: "POST", headers: cookie ? { cookie: "desk_token=fixture" } : {}, body: JSON.stringify(body) }); }
test("chat stores one durable request, executes only validated typed action and replays lost responses", async () => {
 const { POST } = await route;
 const old = globalThis.fetch;
 let completed = false, gateway = 0, complete = 0;
 const receipt = { run_id: 2, task_id: 8 };
 globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
  if (url.includes("/rpc/editorial_chat_begin")) return Response.json(completed ? { state: "completed", reply: "Work queued", action_receipt: receipt } : { state: "running", lease_token: "fenced", agent_config: { role: "coordinator", model: "pinned", instructions: "Help" } });
  if (url.startsWith("https://gateway.example.invalid/")) { gateway++; return Response.json({ choices: [{ message: { content: JSON.stringify({ action: "start_pipeline", reply: "Work queued", brief: "Consolidate approved evidence" }) } }] }); }
  if (url.includes("/rpc/editorial_chat_complete")) { complete++; assert.equal(JSON.parse(String(init?.body)).p_action, "start_pipeline"); completed = true; return Response.json({ state: "completed", reply: "Work queued", action_receipt: receipt }); }
  if (url.includes("editorial_topics?")) return Response.json([{ id: 1, topic_key: "cabeza", title: "Voyage", objective: "Research" }]);
  if (/editorial_(topic_submissions|tasks|pipeline_runs|chat_messages)\?/.test(url)) return Response.json([]);
  throw new Error(`Unexpected request ${url}`);
 };
 try {
  assert.equal((await POST(request(false))).status, 401);
  const first = await POST(request()); assert.equal(first.status, 200); assert.deepEqual((await first.json()).action_receipt, receipt);
  const replay = await POST(request()); assert.equal(replay.status, 200);
  assert.equal(gateway, 1); assert.equal(complete, 1);
 } finally { globalThis.fetch = old; }
});
test("invalid model action fails the recorded turn without creating work or disclosing credentials", async () => {
 const { POST } = await route; const old = globalThis.fetch; let failures = 0, complete = 0;
 globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
  if (url.includes("/rpc/editorial_chat_begin")) return Response.json({ state: "running", lease_token: "fenced", agent_config: { role: "coordinator", model: "pinned", instructions: "Help" } });
  if (url.startsWith("https://gateway.example.invalid/")) return Response.json({ choices: [{ message: { content: '{"action":"publish","reply":"private-key"}' } }] });
  if (url.includes("/rpc/editorial_chat_complete")) { complete++; throw new Error(); }
  if (url.includes("/rpc/editorial_chat_fail")) { failures++; return Response.json({ state: "failed" }); }
  if (url.includes("editorial_topics?")) return Response.json([{ id: 1, title: "Voyage" }]);
  if (/editorial_(topic_submissions|tasks|pipeline_runs|chat_messages)\?/.test(url)) return Response.json([]);
  throw new Error("Unexpected request");
 };
 try { const res = await POST(request()); assert.equal(res.status, 503); const response = await res.text(); assert.match(response, /"recorded":true/); assert.doesNotMatch(response, /private-key/); assert.equal(complete, 0); assert.equal(failures, 1); }
 finally { globalThis.fetch = old; }
});
