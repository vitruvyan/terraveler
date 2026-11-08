import { test } from "node:test";
import assert from "node:assert/strict";
process.env.EDITOR_EMAIL = "editor@example.com";
process.env.POSTGREST_URL = "https://data.example.invalid";
process.env.POSTGREST_SERVICE_KEY = "fixture";
process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
process.env.SUPABASE_AUTH_KEY = "fixture";
const team = import("../lib/editorialTeam");
const input = { agent_key: "researcher", name: "Historical researcher", role: "research", model: "local-default",
  instructions: "Compare candidate sources and retain provenance.", enabled: false, expected_version: 0, request_id: "0123456789abcdef" };

test("agent edits are bounded, typed and tied to a version and stable request", async () => {
  const { parseAgentConfiguration, saveAgentConfiguration } = await team;
  assert.deepEqual(parseAgentConfiguration(input), input);
  for (const bad of [{ ...input, role: "publisher" }, { ...input, expected_version: -1 },
    { ...input, expected_version: 2147483647 }, { ...input, instructions: "" }, { ...input, token: "secret" },
    { ...input, enabled: "true" }, { ...input, model: "x\ny" }]) assert.equal(parseAgentConfiguration(bad), null);
  let called = 0;
  await saveAgentConfiguration(parseAgentConfiguration(input)!, async (name, args) => {
    called++;
    assert.equal(name, "desk_save_editorial_agent");
    assert.equal(args.p_expected_version, 0);
    assert.equal(args.p_request_id, input.request_id);
    assert.equal(args.p_instructions, input.instructions);
    return { version: 1 };
  });
  assert.equal(called, 1);
});

test("model catalogue returns only visible IDs and never retries after a refusal", async () => {
  const { teamModelCatalogue } = await team;
  const env = { EDITOR_LIMEN_BASE_URL: "https://gateway.example/v1", EDITOR_LIMEN_API_KEY: "fixture-secret", EDITOR_LIMEN_DATA_CLASS: "editorial" };
  let calls = 0;
  const result = await teamModelCatalogue(env, async (url, init) => {
    calls++;
    assert.equal(String(url), "https://gateway.example/v1/models");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-secret");
    return Response.json({ data: [{ id: "local-default", internal_key: "must-not-escape" }, { id: "local-default" }] });
  });
  assert.deepEqual(result, { status: "ready", models: [{ id: "local-default" }] });
  assert.equal(calls, 1);
  assert.equal((await teamModelCatalogue(env, async () => { calls++; return new Response("secret denial", { status: 403 }); })).status, "unavailable");
  assert.equal(calls, 2);
  assert.equal((await teamModelCatalogue({ ...env, EDITOR_LIMEN_BASE_URL: "https://api.openai.com/v1" })).status, "not-configured");
  assert.equal((await teamModelCatalogue({})).status, "not-configured");
});

test("team API protects configs and permits pausing during a gateway outage", async t => {
  const old = globalThis.fetch;
  const keys = ["EDITOR_LIMEN_BASE_URL", "EDITOR_LIMEN_API_KEY", "EDITOR_LIMEN_DATA_CLASS"];
  const prior = keys.map(k => process.env[k]);
  keys.forEach(k => delete process.env[k]);
  t.after(() => { globalThis.fetch = old; keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); });
  let editor = true;
  let mutations = 0;
  let conflict = false;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/auth/v1/user")) return Response.json({ email: editor ? "editor@example.com" : "reader@example.com" });
    if (init?.method === "POST") {
      mutations++;
      assert.equal(u.pathname, "/rest/v1/rpc/desk_save_editorial_agent");
      return Response.json(conflict ? { error: "conflict", current_version: 2 } : { agent_key: input.agent_key, version: 1 });
    }
    assert.match(u.pathname, /editorial_agents_current$/);
    return Response.json([]);
  };
  const { GET, POST } = await import("../app/api/desk/team/route");
  const request = (body = input, auth = true, origin?: string) => new Request("https://terraveler.example/api/desk/team", { method: "POST", headers: { ...(auth ? { cookie: "desk_token=fixture" } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await POST(request(input, false))).status, 401);
  assert.equal((await GET(new Request("https://terraveler.example/api/desk/team"))).status, 401);
  editor = false;
  assert.equal((await POST(request())).status, 401);
  editor = true;
  assert.equal((await POST(request(input, true, "https://evil.example"))).status, 403);
  assert.equal((await POST(request({ ...input, enabled: true }))).status, 503);
  assert.equal(mutations, 0);
  assert.equal((await POST(request())).status, 200);
  assert.equal(mutations, 1);
  conflict = true;
  assert.equal((await POST(request())).status, 409);
  const status = await GET(new Request("https://terraveler.example/api/desk/team", { headers: { cookie: "desk_token=fixture" } }));
  const body = await status.json();
  assert.equal(body.execution, "not-connected");
  assert.equal(body.gateway.status, "not-configured");
  assert.deepEqual(body.agents, []);
});
