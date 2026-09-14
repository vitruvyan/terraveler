import { test } from "node:test";
import assert from "node:assert/strict";

let publicGET: any;
let deskGET: any;
let deskPOST: any;

type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

test("Prompt registry API", async (t) => {
  t.before(async () => {
    process.env.EDITOR_EMAIL = "editor@example.com";
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    process.env.SUPABASE_AUTH_URL = "https://mock-auth.example.com";
    process.env.SUPABASE_AUTH_KEY = "mock-auth-key";

    publicGET = (await import("../app/api/prompts/route")).GET;
    const desk = await import("../app/api/desk/prompts/route");
    deskGET = desk.GET;
    deskPOST = desk.POST;

    originalFetch = globalThis.fetch;
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("public GET returns only known prompt keys, with a cache header", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("agent_prompts_current")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([
            { prompt_key: "onboarding", version: 3, body: "hello {{target}}" },
            { prompt_key: "some_removed_key", version: 1, body: "should be dropped" },
          ]),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await publicGET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control") ?? "", /max-age=300/);
    const body = await res.json();
    assert.deepEqual(Object.keys(body.prompts), ["onboarding"]);
    assert.equal(body.prompts.onboarding.version, 3);
  });

  await t.test("desk GET requires an editor session", async () => {
    const req = new Request("http://localhost/api/desk/prompts");
    const res = await deskGET(req);
    assert.equal(res.status, 401);
  });

  await t.test("desk GET returns full version history when authenticated", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }
      if (url.includes("/rest/v1/agent_prompts")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([
            { id: 2, prompt_key: "onboarding", version: 2, body: "v2", notes: null, created_at: "2026-09-14T00:00:00Z", created_by: "editor@example.com" },
            { id: 1, prompt_key: "onboarding", version: 1, body: "v1", notes: "seed", created_at: "2026-08-01T00:00:00Z", created_by: "migration" },
          ]),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const req = new Request("http://localhost/api/desk/prompts", { headers: { cookie: "desk_token=mock" } });
    const res = await deskGET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.versions.length, 2);
  });

  await t.test("desk POST rejects an unknown prompt_key", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };
    const req = new Request("http://localhost/api/desk/prompts", {
      method: "POST", headers: { cookie: "desk_token=mock", "content-type": "application/json" },
      body: JSON.stringify({ prompt_key: "not_a_real_key", body: "x" }),
    });
    const res = await deskPOST(req);
    assert.equal(res.status, 400);
  });

  await t.test("desk POST computes the next version and attributes the editor", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }
      if (url.includes("agent_prompts?prompt_key=eq.onboarding")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ version: 2 }]) } as any;
      }
      if (url.endsWith("/rest/v1/agent_prompts")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{ id: 3, prompt_key: "onboarding", version: 3, body: "new text", notes: "why", created_by: "editor@example.com" }]),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const req = new Request("http://localhost/api/desk/prompts", {
      method: "POST", headers: { cookie: "desk_token=mock", "content-type": "application/json" },
      body: JSON.stringify({ prompt_key: "onboarding", body: "new text", notes: "why" }),
    });
    const res = await deskPOST(req);
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true);
    assert.equal(result.version.version, 3);

    const insertCall = calls.find((c) => c.url.endsWith("/rest/v1/agent_prompts") && c.body?.version === 3);
    assert.ok(insertCall, "must insert the new version");
    assert.equal(insertCall!.body.created_by, "editor@example.com");
  });

  await t.test("desk POST refuses an empty body", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };
    const req = new Request("http://localhost/api/desk/prompts", {
      method: "POST", headers: { cookie: "desk_token=mock", "content-type": "application/json" },
      body: JSON.stringify({ prompt_key: "onboarding", body: "   " }),
    });
    const res = await deskPOST(req);
    assert.equal(res.status, 400);
  });
});
