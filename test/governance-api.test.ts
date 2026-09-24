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
    assert.deepEqual(body.queue.endpoint_context, {});
  });

  // The three fixes below close gaps found in a governance-visibility audit:
  // undeterministic intent order, 'approve' decisions losing their specific
  // target_url behind the endpoint's host_pattern, and pending proposals
  // deduped onto an existing endpoint giving the editor no sign of it.

  await t.test("orders embedded intents by id ascending, deterministically", async (t) => {
    globalThis.fetch = async (input) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }

      if (urlStr.includes("source_proposals?status=eq.submitted")) {
        // Mirrors real PostgREST: the embed is only sorted when the request
        // asks for it via the relation-qualified `relation.order=` param —
        // otherwise it comes back in whatever (here: insertion, id 10 then
        // id 9) order the server happens to hold it in. If the route ever
        // drops that query param, this test starts seeing [10, 9].
        const intents = urlStr.includes("source_proposal_intents.order=id.asc")
          ? [{ voyage: "v9", id: 9 }, { voyage: "v10", id: 10 }]
          : [{ voyage: "v10", id: 10 }, { voyage: "v9", id: 9 }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { id: 1, target_url: "https://example.org/a", endpoint_id: null, source_proposal_intents: intents },
          ]),
        } as any;
      }

      if (urlStr.includes("/rest/v1/")) {
        return { ok: true, status: 200, text: async () => "[]" } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      headers: { cookie: "desk_token=mock_editor_token" },
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const [proposal] = body.queue.pending_proposals;
    assert.deepEqual(
      proposal.source_proposal_intents.map((i: any) => i.id),
      [9, 10],
    );
  });

  await t.test("resolves resolved_target_url for an 'approve' decision via evidence_snapshot", async (t) => {
    globalThis.fetch = async (input) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }

      if (urlStr.includes("source_policy_decisions?order=timestamp.desc")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            {
              // approve: proposal_id is NULL by source_policy_decisions_subject_check,
              // so the source_proposals(target_url) embed is empty and the
              // route must fall back to evidence_snapshot->>'proposal_id'.
              id: 100,
              decision_outcome: "approve",
              trust_mode: "domain_trusted",
              rights_class: "public_domain",
              reason: "trusted archive",
              timestamp: "2026-01-01T00:00:00Z",
              proposal_id: null,
              endpoint_id: 5,
              evidence_snapshot: { proposal_id: 42, target_url: "https://archive.org/verrazzano-letter" },
              source_endpoints: { host_pattern: "archive.org" },
              source_proposals: null,
            },
            {
              // reject: proposal_id (and the embed) are already populated
              // natively — no extra resolution should be needed for it.
              id: 101,
              decision_outcome: "reject",
              trust_mode: null,
              rights_class: "unknown",
              reason: "no rights evidence",
              timestamp: "2026-01-02T00:00:00Z",
              proposal_id: 7,
              endpoint_id: null,
              evidence_snapshot: { proposal_id: 7, target_url: "https://example.org/rejected" },
              source_endpoints: null,
              source_proposals: { target_url: "https://example.org/rejected" },
            },
          ]),
        } as any;
      }

      if (urlStr.includes("source_proposals?id=in.")) {
        // Only the approve row's proposal id should ever need batch
        // resolution — the reject row already carried its embed.
        assert.match(urlStr, /id=in\.\(42\)/);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: 42, target_url: "https://archive.org/verrazzano-letter" }]),
        } as any;
      }

      if (urlStr.includes("/rest/v1/")) {
        return { ok: true, status: 200, text: async () => "[]" } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      headers: { cookie: "desk_token=mock_editor_token" },
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const [approveDecision, rejectDecision] = body.queue.recent_decisions;
    assert.equal(approveDecision.resolved_target_url, "https://archive.org/verrazzano-letter");
    assert.equal(rejectDecision.resolved_target_url, "https://example.org/rejected");
    // Nothing existing was dropped — host_pattern is still there for callers
    // (today's SourceGovernance.tsx) that haven't switched to the new field.
    assert.equal(approveDecision.source_endpoints.host_pattern, "archive.org");
  });

  await t.test("builds endpoint_context for a pending proposal deduped onto an existing endpoint", async (t) => {
    globalThis.fetch = async (input) => {
      const urlStr = typeof input === "string" ? input : (input as any).url;

      if (urlStr.includes("/auth/v1/user")) {
        return { ok: true, status: 200, json: async () => ({ email: "editor@example.com" }) } as any;
      }

      if (urlStr.includes("source_proposals?status=eq.submitted")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { id: 2, target_url: "https://archive.org/other-letter", endpoint_id: 99, source_proposal_intents: [] },
            // A second, brand-new-domain proposal with no endpoint_id should
            // simply be absent from endpoint_context, not error.
            { id: 3, target_url: "https://new-domain.example/x", endpoint_id: null, source_proposal_intents: [] },
          ]),
        } as any;
      }

      if (urlStr.includes("source_endpoints?id=in.")) {
        assert.match(urlStr, /id=in\.\(99\)/);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { id: 99, host_pattern: "archive.org", trust_mode: "item_verified", status: "active" },
          ]),
        } as any;
      }

      if (urlStr.includes("source_policy_decisions?endpoint_id=in.")) {
        // Simulates order=timestamp.desc,id.desc — newest first.
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([
            { id: 12, endpoint_id: 99, decision_outcome: "approve", trust_mode: "item_verified", rights_class: "public_domain", reason: "second look", timestamp: "2026-06-01T00:00:00Z" },
            { id: 11, endpoint_id: 99, decision_outcome: "approve", trust_mode: "domain_trusted", rights_class: "public_domain", reason: "first approval", timestamp: "2024-01-01T00:00:00Z" },
          ]),
        } as any;
      }

      if (urlStr.includes("/rest/v1/")) {
        return { ok: true, status: 200, text: async () => "[]" } as any;
      }

      return { ok: false, status: 404 } as any;
    };

    const req = new Request("http://localhost/api/desk/governance", {
      headers: { cookie: "desk_token=mock_editor_token" },
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const ctx = body.queue.endpoint_context["99"];
    assert.ok(ctx, "endpoint_context should have an entry for endpoint 99");
    assert.equal(ctx.host_pattern, "archive.org");
    assert.equal(ctx.trust_mode, "item_verified");
    assert.equal(ctx.status, "active");
    assert.equal(ctx.last_decision.id, 12, "should pick the most recent approve decision");
    assert.equal(body.queue.endpoint_context["3"], undefined, "no endpoint_id -> no context entry");
  });
});
