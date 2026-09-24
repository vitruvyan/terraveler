import { test } from "node:test";
import assert from "node:assert/strict";

// We dynamically import GET/POST so env vars are set before the module loads
let GET: any;
let POST: any;

type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

test("Governance Queue API Endpoint", async (t) => {
  t.before(async () => {
    process.env.EDITOR_EMAIL = "editor@example.com";
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    process.env.SUPABASE_AUTH_URL = "https://mock-auth.example.com";
    process.env.SUPABASE_AUTH_KEY = "mock-auth-key";

    // Load GET/POST route handlers dynamically after env vars are established
    const route = await import("../app/api/desk/governance/route");
    GET = route.GET;
    POST = route.POST;

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

  // source-proposal-resolution-authority (PR-2): mcp_resolve_source_proposal
  // now refuses to resolve a proposal that carries more than one
  // source_proposal_intents row, or that targets a collection, returning
  // {error: "..."} instead of writing anything. This route must surface
  // that as a 409 with the RPC's own message intact -- not a generic 500 --
  // the same way it already does for any other RPC-reported error.
  await t.test("surfaces mcp_resolve_source_proposal's multi-intent refusal as a readable 409, not a 500", async (t) => {
    globalThis.fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }
      if (urlStr.includes("/rest/v1/human_principals")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (urlStr.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        // What the RPC itself returns for a multi-intent proposal: HTTP 200,
        // an {error} payload -- PostgREST does not turn an application-level
        // jsonb_build_object('error', ...) into a non-2xx status.
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            error: "proposal #13 carries 2 distinct intents -- a single verdict cannot resolve them together; per-intent resolution is not yet supported",
          }),
        } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      method: "POST",
      headers: { cookie: "desk_token=mock_editor_token", "content-type": "application/json" },
      body: JSON.stringify({
        proposal_id: 13,
        decision: "approve",
        trust_mode: "domain_trusted",
        rights_class: "public_domain",
        reason: "looks fine",
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 409, "an RPC-reported error must not fall through to a generic 500");
    const body = await res.json();
    assert.match(body.error, /carries 2 distinct intents/,
      "the editor must see the RPC's own explanation, not a generic failure message");
  });
});
