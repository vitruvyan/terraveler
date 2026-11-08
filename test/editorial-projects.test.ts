import { test } from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const projects = import("../lib/editorialProjects");

test("project work uses explicit topic and typed idempotent start, never title matching or publication", async () => {
  const { parseProjectAction, applyProjectAction, editorialExecution } = await projects;
  for (const bad of [{ action: "publish", topic_id: 1 }, { action: "start", topic_id: -1 },
    { action: "start", topic_id: 1, brief: "Write", request_id: "request-000000001", sql: "anything" }]) assert.equal(parseProjectAction(bad), null);
  const start = parseProjectAction({ action: "start", topic_id: 1, brief: " Consolidate sources ", request_id: "request-000000001" });
  assert.ok(start);
  let calls = 0;
  await applyProjectAction(start, async (name, args) => {
    calls++; assert.equal(name, "editorial_start_pipeline");
    assert.deepEqual(args, { p_topic_id: 1, p_brief: "Consolidate sources", p_request_id: "request-000000001" });
    return { run_id: 7, task_id: 4 };
  });
  assert.equal(calls, 1);
  assert.deepEqual(editorialExecution({ EDITORIAL_WORKFLOW_ENABLED: "1" }), { configured: true, worker_health: "not-observed" });
});

test("project detail nests same-topic contributions, stored draft and actual queue state", async () => {
  const { readEditorialProject, readEditorialMessages } = await projects;
  const requested: string[] = [];
  const read = async (_method: string, path: string) => {
    requested.push(path);
    if (path.includes("offset=1")) return [];
    if (path.startsWith("editorial_topics?")) return [{ id: 1, topic_key: "cabeza", title: "Cabeza", objective: "One article" }];
    if (path.startsWith("editorial_topic_submissions?")) return [{ topic_id: 1, submission_id: 111, snapshot: { type: "idea", status: "approved", payload: { title: "Cabeza research" } } }];
    if (path.startsWith("editorial_tasks?")) return [{ topic_id: 1, id: 8, role: "reviewer", state: "queued", attempt: 0 }];
    if (path.startsWith("editorial_pipeline_runs?")) return [{ topic_id: 1, id: 3, state: "reviewing", current_task_id: 8, draft_task_id: 7, revision: 0 }];
    if (path.startsWith("editorial_results?")) return [{ result: { kind: "draft", title: "Consolidated", body: "Sourced draft", provider_secret: "do-not-return" } }];
    if (path.startsWith("editorial_chat_messages?")) return [{ role: "assistant", content: "Latest", created_at: "2" }, { role: "user", content: "First", created_at: "1" }];
    throw new Error("unexpected query");
  };
  const view = await readEditorialProject(1, read);
  assert.equal(view?.contributions[0].submission_id, 111);
  assert.deepEqual(view?.latest_draft, { title: "Consolidated", body: "Sourced draft" });
  assert.match(view!.pipeline!.next_step, /Waiting/);
  assert.doesNotMatch(JSON.stringify(view), /do-not-return/);
  assert.equal((await readEditorialMessages(1, read))[0].content, "First");
  assert.ok(requested.some(p => p.startsWith("editorial_results?task_id=eq.7")));
});

test("projects route checks editor, origin and disabled work before mutation", async () => {
  const { GET, POST } = await import("../app/api/desk/projects/route");
  const old = globalThis.fetch;
  const flag = process.env.EDITORIAL_WORKFLOW_ENABLED;
  let mutations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    mutations++; throw new Error("unexpected mutation");
  };
  const req = (body: unknown, origin = "http://local") => new Request("http://local/api/desk/projects", { method: "POST", headers: { cookie: "desk_token=fixture", origin }, body: JSON.stringify(body) });
  try {
    assert.equal((await GET(new Request("http://local/api/desk/projects"))).status, 401);
    assert.equal((await POST(req({}, "http://foreign"))).status, 403);
    process.env.EDITORIAL_WORKFLOW_ENABLED = "0";
    assert.equal((await POST(req({ action: "start", topic_id: 1, brief: "Research", request_id: "request-000000001" }))).status, 503);
    assert.equal((await GET(new Request("http://local/api/desk/projects?topic_id=1%26limit=99", { headers: { cookie: "desk_token=fixture" } }))).status, 400);
    assert.equal(mutations, 0);
  } finally { globalThis.fetch = old; if (flag === undefined) delete process.env.EDITORIAL_WORKFLOW_ENABLED; else process.env.EDITORIAL_WORKFLOW_ENABLED = flag; }
});
