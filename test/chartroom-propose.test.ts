import { test } from "node:test";
import assert from "node:assert/strict";

let POST: any;
type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

function req(body: unknown, cookie: string | null = "desk_token=mock-token") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== null) headers.cookie = cookie;
  return new Request("http://localhost/api/chartroom/propose", { method: "POST", headers, body: JSON.stringify(body) });
}

/** Mocks the full signedInHuman() chain (Supabase Auth /user, then
 *  human_principals + contributors lookups) so each test only has to
 *  additionally handle the submissions/audit_log calls it cares about. */
function mockHumanAuth(calls: { url: string; body: any }[], extra: (url: string, init: any) => any) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as any).url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });

    if (url.includes("/auth/v1/user")) {
      return { ok: true, status: 200, json: async () => ({ id: "sub-123", email: "reader@example.test" }) } as any;
    }
    if (url.includes("human_principals?auth_sub=")) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 42 }]) } as any;
    }
    if (url.includes("contributors?human_principal_id=")) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 7, handle: "traveler-abc123", rank: "cabin-boy", status: "active" }]) } as any;
    }
    if (url.includes("agent_accounts?contributor_id=in.")) {
      return { ok: true, status: 200, text: async () => JSON.stringify([]) } as any;
    }
    return extra(url, init);
  };
}

test("Chartroom human proposal endpoint", async (t) => {
  t.before(async () => {
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    process.env.SUPABASE_AUTH_URL = "https://mock-auth.example.com";
    process.env.SUPABASE_AUTH_KEY = "mock-auth-key";
    POST = (await import("../app/api/chartroom/propose/route")).POST;
    originalFetch = globalThis.fetch;
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("rejects an anonymous request", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("/auth/v1/user")) return { ok: false, status: 401 } as any;
      return { ok: false, status: 404 } as any;
    };
    const res = await POST(req({ title: "A voyage", why: "Because nobody has told this story yet." }, null));
    assert.equal(res.status, 401);
  });

  await t.test("rejects a title that's too short", async () => {
    const calls: any[] = [];
    mockHumanAuth(calls, () => ({ ok: false, status: 404, text: async () => "unexpected" } as any));
    const res = await POST(req({ title: "Hi", why: "Because nobody has told this story yet, at all." }));
    assert.equal(res.status, 400);
  });

  await t.test("rejects a missing reason", async () => {
    const calls: any[] = [];
    mockHumanAuth(calls, () => ({ ok: false, status: 404, text: async () => "unexpected" } as any));
    const res = await POST(req({ title: "A real title here", why: "too short" }));
    assert.equal(res.status, 400);
  });

  await t.test("submits a valid proposal as an idea in human-review, with a matching audit_log row", async () => {
    const calls: { url: string; body: any }[] = [];
    mockHumanAuth(calls, (url) => {
      if (url.endsWith("/rest/v1/submissions")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 501 }]) } as any;
      }
      if (url.endsWith("/rest/v1/audit_log")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 9001 }]) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    });

    const res = await POST(req({
      category: "stories", title: "The conquest of Antarctica", why: "It's a story worth telling, with real historical stakes.",
      context: "Connects to the age of exploration voyages.", evidence: "Amundsen and Scott's expedition logs.",
    }));
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true);
    assert.equal(result.submission_id, 501);
    assert.equal(result.status, "human-review");

    const submissionCall = calls.find((c) => c.url.endsWith("/rest/v1/submissions"));
    assert.ok(submissionCall, "must insert into submissions");
    assert.equal(submissionCall!.body.type, "idea");
    assert.equal(submissionCall!.body.status, "human-review");
    assert.equal(submissionCall!.body.contributor_id, 7);
    assert.equal(submissionCall!.body.payload.title, "The conquest of Antarctica");
    assert.equal(submissionCall!.body.payload.kind, "stories");
    assert.ok(submissionCall!.body.content_fingerprint);

    const auditCall = calls.find((c) => c.url.endsWith("/rest/v1/audit_log"));
    assert.ok(auditCall, "must write an audit_log row");
    assert.equal(auditCall!.body.actor, "contributor:traveler-abc123");
    assert.equal(auditCall!.body.action, "proposal");
  });

  await t.test("reports a duplicate as 409, not a raw 500", async () => {
    const calls: { url: string; body: any }[] = [];
    mockHumanAuth(calls, (url) => {
      if (url.endsWith("/rest/v1/submissions")) {
        return { ok: false, status: 409, text: async () => "duplicate key value violates unique constraint (23505)" } as any;
      }
      if (url.includes("/rest/v1/submissions?")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 77 }]) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    });

    const res = await POST(req({ title: "The same idea again", why: "Explaining the exact same thing a second time." }));
    assert.equal(res.status, 409);
    const result = await res.json();
    assert.match(result.error, /DUPLICATE_SUBMISSION/);
  });
});
