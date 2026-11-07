import { test } from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const actions = import("../lib/editorActions");

const rename = {
  action: "rename",
  target_type: "submission",
  target_id: "111",
  value: "A concise title",
  expected_version: 0,
  request_id: "8a23cab7-1b15-4d58-a842-5c056187fa91",
};

test("editorial titles are explicit immutable overlays with a concurrency version", async () => {
  const { editorialTitleFromAudit } = await actions;
  const audit = [
    {
      id: 1,
      action: "editorial-title",
      actor: "editor-in-chief",
      findings: {
        target_type: "submission",
        target_id: "111",
        title: "Earlier title",
      },
    },
    {
      id: 3,
      action: "editorial-title",
      actor: "scribe",
      findings: {
        target_type: "submission",
        target_id: "111",
        title: "Not authoritative",
      },
    },
    {
      id: 4,
      action: "editorial-title",
      actor: "editor-in-chief",
      findings: {
        target_type: "submission",
        target_id: "112",
        title: "Another record",
      },
    },
    {
      id: 2,
      action: "editorial-title",
      actor: "editor-in-chief",
      findings: {
        target_type: "submission",
        target_id: "111",
        title: "Current title",
      },
    },
  ];
  assert.deepEqual(editorialTitleFromAudit(audit, "submission", 111), {
    title: "Current title",
    version: 2,
  });
  assert.deepEqual(editorialTitleFromAudit(audit, "project", 111), {
    title: null,
    version: 0,
  });
  assert.equal((audit[0].findings as any).title, "Earlier title");
});

test("write input is bounded and cannot select arbitrary resources or omit title version", async () => {
  const { parseEditorAction } = await actions;
  assert.ok(parseEditorAction(rename));
  assert.equal(
    parseEditorAction({ ...rename, expected_version: undefined }),
    null,
  );
  assert.equal(
    parseEditorAction({ ...rename, target_id: "111&status=eq.approved" }),
    null,
  );
  assert.equal(
    parseEditorAction({
      ...rename,
      target_type: "voyage",
      target_id: "not-a-published-voyage",
    }),
    null,
  );
  assert.equal(parseEditorAction({ ...rename, value: "x".repeat(201) }), null);
  assert.equal(parseEditorAction({ ...rename, action: "publish" }), null);
  assert.equal(
    parseEditorAction({
      ...rename,
      action: "request-revision",
      value: "Review the cited passage",
      expected_version: undefined,
    })?.action,
    "request-revision",
  );
});

test("editor actions use one atomic RPC with the caller's idempotency key, not a payload patch", async () => {
  const {
    parseEditorAction,
    executeEditorAction,
    missingEditorActionMigration,
  } = await actions;
  const calls: unknown[] = [];
  const action = parseEditorAction(rename)!;
  const result = await executeEditorAction(action, async (name, args) => {
    calls.push({ name, args });
    return { title: action.value, title_version: 42 };
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: "desk_editorial_action",
    args: {
      p_action: "rename",
      p_target_type: "submission",
      p_target_id: "111",
      p_value: "A concise title",
      p_expected_version: 0,
      p_request_id: rename.request_id,
      p_agent_account_id: null,
      p_carta: "0.7",
    },
  });
  assert.equal(result.title_version, 42);
  assert.equal(
    missingEditorActionMigration(
      new Error(
        "rpc desk_editorial_action: 404 Could not find function in schema cache",
      ),
    ),
    true,
  );
  assert.equal(missingEditorActionMigration(new Error("unavailable")), false);
});

test("editor edit endpoint requires editor identity and preserves conflict and migration errors", async (t) => {
  process.env.EDITOR_EMAIL = "editor@example.com";
  process.env.POSTGREST_URL = "https://data.example.invalid";
  process.env.POSTGREST_SERVICE_KEY = "fixture";
  process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
  process.env.SUPABASE_AUTH_KEY = "fixture";
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  let mode: "conflict" | "missing" | "ok" = "conflict";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/v1/user"))
      return Response.json({ email: "editor@example.com" });
    calls++;
    assert.equal(url.pathname, "/rest/v1/rpc/desk_editorial_action");
    return mode === "missing"
      ? new Response("Could not find desk_editorial_action in schema cache", {
          status: 404,
        })
      : Response.json(
          mode === "conflict"
            ? { error: "conflict", title: "New title", title_version: 2 }
            : { title: "Saved title", title_version: 3 },
        );
  };
  const { POST } = await import("../app/api/desk/edit/route");
  const request = (auth = true, body: unknown = rename) =>
    new Request("https://terraveler.example/api/desk/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { cookie: "desk_token=fixture" } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await POST(request(false))).status, 401);
  assert.equal(calls, 0);
  assert.equal(
    (await POST(request(true, { ...rename, expected_version: undefined })))
      .status,
    400,
  );
  const conflict = await POST(request());
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).title_version, 2);
  mode = "missing";
  const missing = await POST(request());
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "editor-actions-unavailable");
  mode = "ok";
  const ok = await POST(request());
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).result.title_version, 3);
});
