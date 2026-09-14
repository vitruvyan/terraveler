import { test } from "node:test";
import assert from "node:assert/strict";

// We dynamically import GET so env vars are set before the module loads
let GET: any;

type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

test("Governance Queue API Endpoint", async (t) => {
  t.before(async () => {
    process.env.EDITOR_EMAIL = "editor@example.com";
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    process.env.SUPABASE_AUTH_URL = "https://mock-auth.example.com";
    process.env.SUPABASE_AUTH_KEY = "mock-auth-key";

    // Load GET route handler dynamically after env vars are established
    const route = await import("../app/api/desk/governance/route");
    GET = route.GET;

    originalFetch = globalThis.fetch;
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("distinguishes empty queue from broken Supabase query", async (t) => {
    globalThis.fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: "editor@example.com" })
        } as any;
      }

      if (urlStr.includes("/rest/v1/")) {
        return {
          ok: false,
          status: 500,
          text: async () => "PostgREST database error"
        } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      headers: {
        cookie: "desk_token=mock_editor_token"
      }
    });

    const res = await GET(req);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.ok(body.error);
    assert.match(body.error, /backend 500: PostgREST database error/);
  });

  await t.test("returns empty lists on successful empty queries", async (t) => {
    globalThis.fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: "editor@example.com" })
        } as any;
      }

      if (urlStr.includes("/rest/v1/")) {
        return {
          ok: true,
          status: 200,
          text: async () => "[]"
        } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      headers: {
        cookie: "desk_token=mock_editor_token"
      }
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.success);
    // pending_proposals and recent_decisions were the actual gap this route
    // existed to close (see the route's own comment): a proposal sitting at
    // status='submitted' had nowhere to be seen. review_required_endpoints
    // and recent_material_drifts predate that fix and stay as they were.
    assert.deepEqual(body.queue.pending_proposals, []);
    assert.deepEqual(body.queue.recent_decisions, []);
    assert.deepEqual(body.queue.review_required_endpoints, []);
    assert.deepEqual(body.queue.recent_material_drifts, []);
  });
});
