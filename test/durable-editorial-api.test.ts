import { test } from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const workflow = import("../lib/editorialWorkflow");
const input = { submission_id: 111, topic_key: "cabeza-de-vaca", title: "Cabeza de Vaca", objective: "Reconcile the Spanish sources and prepare one sourced draft." };

test("dossier bootstrap rejects ambiguous identities and arbitrary actions", async () => {
  const { parseEditorialStart, startEditorialWork } = await workflow;
  assert.deepEqual(parseEditorialStart(input), input);
  for (const invalid of [{ ...input, submission_id: 1.5 }, { ...input, topic_key: "x&id=eq.3" },
    { ...input, objective: " " }, { ...input, title: "x".repeat(201) }, { ...input, publish: true }]) {
    assert.equal(parseEditorialStart(invalid), null);
  }
  const calls: unknown[] = [];
  await startEditorialWork(input, async (name, args) => { calls.push({ name, args }); return { topic_id: 1 }; });
  assert.deepEqual(calls, [{ name: "editorial_start", args: {
    p_submission_id: 111, p_topic_key: input.topic_key, p_title: input.title, p_objective: input.objective,
  } }]);
});

test("workflow API authenticates before reads/writes and fails closed until explicitly enabled", async t => {
  const oldFetch = globalThis.fetch;
  const oldEnabled = process.env.EDITORIAL_WORKFLOW_ENABLED;
  t.after(() => { globalThis.fetch = oldFetch; if (oldEnabled === undefined) delete process.env.EDITORIAL_WORKFLOW_ENABLED; else process.env.EDITORIAL_WORKFLOW_ENABLED = oldEnabled; });
  let editor = true;
  let fail = false;
  let reads = 0;
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/auth/v1/user")) return Response.json({ email: editor ? "editor@example.com" : "reader@example.com" });
    if (init?.method === "POST") { writes++; return Response.json({ topic_id: 1, task_id: 2, replayed: false }); }
    reads++;
    if (fail) return new Response("missing relation", { status: 404 });
    assert.match(u.pathname, /editorial_topics$/);
    assert.equal(u.searchParams.get("limit"), "100");
    return Response.json([{ id: 1, title: input.title }]);
  };
  const { GET, POST } = await import("../app/api/desk/workflow/route");
  const request = (cookie = true, body: unknown = input, origin?: string) => new Request("https://terraveler.example/api/desk/workflow", {
    method: "POST", headers: { ...(cookie ? { cookie: "desk_token=fixture" } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request(false))).status, 401);
  editor = false;
  assert.equal((await POST(request())).status, 401);
  assert.equal(writes, 0);
  editor = true;
  delete process.env.EDITORIAL_WORKFLOW_ENABLED;
  assert.equal((await POST(request())).status, 503);
  process.env.EDITORIAL_WORKFLOW_ENABLED = "1";
  assert.equal((await POST(request(true, input, "https://evil.example"))).status, 403);
  assert.equal((await POST(request(true, { ...input, publish: true }))).status, 400);
  assert.equal(writes, 0);
  const started = await POST(request());
  assert.equal(started.status, 200);
  assert.equal((await started.json()).publication, "human-authorization-required");
  assert.equal(writes, 1);
  const get = (query = "", auth = true) => new Request(`https://terraveler.example/api/desk/workflow${query}`, { headers: auth ? { cookie: "desk_token=fixture" } : {} });
  assert.equal((await GET(get("", false))).status, 401);
  assert.equal((await GET(get("?topic_id=1%26status=eq.done"))).status, 400);
  assert.equal(reads, 0);
  const page = await GET(get());
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  fail = true;
  assert.equal((await GET(get())).status, 503);
});

test("dossier detail filters results through their task relation and excludes lease credentials", async () => {
  const { readEditorialWork } = await workflow;
  const calls: string[] = [];
  const result = await readEditorialWork(7, 20, async (_method, path) => {
    calls.push(path);
    if (path.startsWith("editorial_topics?")) return [{ id: 7 }];
    if (path.startsWith("editorial_tasks?")) return [{ id: 10, state: "running", attempt: 1 }];
    return [{ id: 3, task_id: 10 }];
  });
  assert.equal("topic" in result && result.topic.id, 7);
  assert.ok(calls.some(path => path.includes("editorial_tasks!inner(topic_id)")));
  assert.ok(calls.some(path => path.includes("editorial_tasks.topic_id=eq.7")));
  assert.ok(calls.some(path => path.startsWith("editorial_tasks?") && path.includes("id=lt.20")));
  assert.ok(calls.some(path => path.includes("editorial_task_agents(agent_version_id,editorial_agent_versions(agent_key,version,name,model))")));
  assert.ok(calls.every(path => !path.includes("lease_token")));
});
