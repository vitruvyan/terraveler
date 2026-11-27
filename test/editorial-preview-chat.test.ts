import test from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
process.env.EDITORIAL_WORKFLOW_ENABLED = "1";
process.env.EDITOR_LIMEN_BASE_URL = "https://limen.example.invalid/v1";
process.env.EDITOR_LIMEN_API_KEY = "scoped-fixture";
process.env.EDITOR_LIMEN_DATA_CLASS = "editorial";

test("preview revision request resolves the inspected version before storing or calling a model", async () => {
  const { POST } = await import("../app/api/desk/projects/chat/route");
  const old = globalThis.fetch;
  let missing = false, begins = 0, generated = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    if (url.includes("editorial_graph_tasks?")) return Response.json([]);
    if (url.includes("editorial_topics?")) return Response.json([{ id: 1, topic_key: "voyage", title: "Voyage", objective: "Research" }]);
    if (url.includes("editorial_results?") && url.includes("role=eq.writer")) {
      assert.match(url, /id=eq.44/); assert.match(url, /topic_id=eq.1/);
      return Response.json(missing ? [] : [{ id: 44, task_id: 7, created_at: "2026-11-16", result: { kind: "draft", title: "Inspected old version", body: "Old version paragraph.", citations: [], references: [] } }]);
    }
    if (url.includes("editorial_results?")) return Response.json([]);
    if (url.endsWith("rpc/editorial_chat_begin")) {
      begins++; const body = JSON.parse(String(init?.body));
      assert.equal(body.p_message, "Regarding saved draft result #44:\nCorrect the dates");
      return Response.json({ lease_token: "lease", agent_config: { role: "coordinator", model: "local-default", instructions: "Help the editor." } });
    }
    if (url.includes("editorial_topic_submissions?") || url.includes("editorial_tasks?") || url.includes("editorial_pipeline_runs?") || url.includes("editorial_chat_messages?")) return Response.json([]);
    if (url.endsWith("chat/completions")) {
      generated++;
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.messages[1].content.split("JSON:\n")[1]);
      assert.equal(context.project.inspected_draft.result_id, 44);
      assert.equal(context.project.inspected_draft.body, "Old version paragraph.");
      assert.equal(context.project.latest_draft, null);
      return Response.json({ choices: [{ message: { content: '{"action":"reply","reply":"I see the inspected version."}' } }] });
    }
    if (url.endsWith("rpc/editorial_chat_complete")) return Response.json({ reply: "I see the inspected version." });
    throw Error(`Unexpected request: ${url}`);
  };
  const request = (draft_result_id: unknown = 44) => new Request("http://local/api/desk/projects/chat", { method: "POST", headers: { cookie: "desk_token=fixture", origin: "http://local" }, body: JSON.stringify({ topic_id: 1, draft_result_id, request_id: "preview-request-0001", message: "Correct the dates" }) });
  try {
    assert.equal((await POST(request(-1))).status, 400);
    assert.equal(begins, 0);
    assert.equal((await POST(request())).status, 200);
    assert.equal(begins, 1); assert.equal(generated, 1);
    missing = true;
    assert.equal((await POST(request())).status, 404);
    assert.equal(begins, 1); assert.equal(generated, 1);
  } finally { globalThis.fetch = old; }
});
