import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.SUPABASE_AUTH_URL = "https://auth.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const modulePromise = import("../lib/adminDashboard");
const catalogue = async () => ({ status: "ready" as const, models: [{ id: "local-default" }] });
function reader(failed = "") {
  const paths: string[] = [];
  return { paths, read: async (_method: string, path: string) => {
    paths.push(path);
    if (failed && path.startsWith(failed)) throw Error("PRIVATE ERROR DETAIL");
    if (/offset=[1-9]/.test(path)) return [];
    if (path.startsWith("editorial_topics?")) return [{ id: 1, title: "Voyage", topic_key: "voyage", objective: "Research" }];
    if (path.startsWith("editorial_tasks?")) return [{ id: 7, topic_id: 1, role: "writer", state: "running", attempt: 1 }];
    if (path.startsWith("editorial_pipeline_runs?")) return [{ id: 2, topic_id: 1, state: "writing", current_task_id: 7, revision: 0 }];
    if (path.startsWith("editorial_specialist_agents_current?")) return [{ name: "Historian", role: "research", model: "local-default", enabled: true, version: 1, instructions: "PRIVATE PROMPT" }];
    if (path.startsWith("editorial_results?")) return [{ id: 9, kind: "draft", title: "Newest", editorial_tasks: { topic_id: 1 } }, { id: 8, kind: "draft", title: "Older", editorial_tasks: [{ topic_id: 1 }] }];
    if (path.startsWith("submissions?")) return [{ status: "human-review" }, { status: "approved" }];
    if (path.startsWith("editorial_topic_submissions?")) return [];
    throw Error("Unexpected query");
  } };
}
test("admin overview separates configuration, queue state, saved candidates and publication records", async () => {
  const { readAdminDashboard } = await modulePromise;
  const fixture = reader();
  const data = await readAdminDashboard(fixture.read, catalogue);
  assert.equal(data.worker_health, "not-observed");
  assert.deepEqual(data.gateway, { status: "ready", models: ["local-default"] });
  assert.equal(data.projects?.[0].running, 1);
  assert.equal(data.drafts?.length, 1); assert.equal(data.drafts?.[0].result_id, 9);
  assert.deepEqual(data.publication, { awaiting_decision: 1 });
  assert.equal(data.errors.length, 0);
  const { ATLAS } = await import("../lib/voyages");
  assert.equal(data.atlas.length, ATLAS.length);
  assert.ok(data.atlas.every(v => v.href.startsWith("/")));
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE/);
  assert.ok(fixture.paths.some(p => p.includes("kind:result->>kind,title:result->>title")));
});
test("a failed registry is unknown while independent projects and gateway remain available", async () => {
  const { readAdminDashboard } = await modulePromise;
  const fixture = reader("editorial_specialist_agents_current?");
  const data = await readAdminDashboard(fixture.read, catalogue);
  assert.equal(data.agents, null);
  assert.deepEqual(data.errors, ["Agent registry"]);
  assert.equal(data.projects?.length, 1);
  assert.equal(data.gateway.status, "ready");
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE ERROR/);
});
test("dashboard API rejects an anonymous caller before database or gateway reads", async () => {
  const { GET } = await import("../app/api/desk/dashboard/route");
  const response = await GET(new Request("https://site.invalid/api/desk/dashboard"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
});
