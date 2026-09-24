import { test } from "node:test";
import assert from "node:assert/strict";

let POST: any;
type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

const SECRET = "test-webhook-secret";

function telegramUpdate(data: string, text = "📚 Nuova proposta di source — #12\nctext.org") {
  return {
    callback_query: {
      id: "cbq-1",
      data,
      message: { chat: { id: 999 }, message_id: 42, text },
    },
  };
}

function req(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("Telegram webhook", async (t) => {
  t.before(async () => {
    process.env.EDITOR_EMAIL = "editor@example.com";
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    process.env.TELEGRAM_TOKEN = "mock-bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;

    const route = await import("../app/api/telegram/webhook/route");
    POST = route.POST;
    originalFetch = globalThis.fetch;
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("rejects a request without the correct secret header", async () => {
    const res = await POST(req(telegramUpdate("src:approve:12"), "wrong-secret"));
    assert.equal(res.status, 401);
  });

  await t.test("rejects a request with no secret header at all", async () => {
    const res = await POST(req(telegramUpdate("src:approve:12"), null));
    assert.equal(res.status, 401);
  });

  await t.test("acks and ignores an update that isn't a button press", async () => {
    let telegramCalls = 0;
    globalThis.fetch = async () => { telegramCalls++; return { ok: true, json: async () => ({ ok: true }) } as any; };
    const res = await POST(req({ message: { text: "hello" } }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(telegramCalls, 0, "an update with no callback_query should never call Telegram back");
  });

  await t.test("src:approve resolves a submitted proposal using the agent's suggested classification", async (t) => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });

      if (url.includes("api.telegram.org")) {
        return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      }
      if (url.includes("source_proposals?id=eq.12")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 12, target_url: "https://ctext.org/", status: "submitted",
            source_proposal_intents: [{ reason: "classical texts", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("human_principals?email=eq.")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 5, proposal_id: 12, status: "resolved" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await POST(req(telegramUpdate("src:approve:12")));
    assert.equal(res.status, 200);

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.ok(rpcCall, "must call the resolve RPC");
    assert.equal(rpcCall!.body.p_decision, "approve");
    assert.equal(rpcCall!.body.p_trust_mode, "item_verified");
    assert.equal(rpcCall!.body.p_rights_class, "mixed");
    assert.equal(rpcCall!.body.p_decided_by_actor_type, "human");
    assert.equal(rpcCall!.body.p_decided_by_actor_id, 1);

    const answered = calls.find((c) => c.url.includes("answerCallbackQuery"));
    assert.ok(answered, "must acknowledge the tap");
    assert.equal(answered!.body.show_alert, false);

    const edited = calls.find((c) => c.url.includes("editMessageText"));
    assert.ok(edited, "must close the message so a second tap can't refire it");
    assert.deepEqual(edited!.body.reply_markup, { inline_keyboard: [] });
  });

  await t.test("src:approve refuses to one-tap a proposal with no agent-suggested trust_mode", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.13")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 13, target_url: "https://example.org/", status: "submitted",
            source_proposal_intents: [{ reason: "no classification given", suggested_trust_mode: null, suggested_rights_class: null }],
          }]),
        } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    await POST(req(telegramUpdate("src:approve:13")));

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.equal(rpcCall, undefined, "must not resolve without a trust_mode to act on");
    const answered = calls.find((c) => c.url.includes("answerCallbackQuery"));
    assert.equal(answered!.body.show_alert, true);
    assert.match(answered!.body.text, /trust_mode/);
  });

  await t.test("src:reject on an already-resolved proposal shows an alert instead of re-resolving", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.14")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 14, target_url: "https://x.org/", status: "resolved", source_proposal_intents: [] }]) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    await POST(req(telegramUpdate("src:reject:14")));

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.equal(rpcCall, undefined, "must not double-resolve");
    const edited = calls.find((c) => c.url.includes("editMessageText"));
    assert.equal(edited, undefined, "must not touch the message on an alert outcome");
    const answered = calls.find((c) => c.url.includes("answerCallbackQuery"));
    assert.equal(answered!.body.show_alert, true);
    assert.match(answered!.body.text, /già risolta|resolved/i);
  });

  await t.test("an unrecognized domain in callback_data is acknowledged without acting", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
    };

    await POST(req(telegramUpdate("wat:approve:1")));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("answerCallbackQuery"));
    assert.equal(calls[0].body.show_alert, true);
  });

  await t.test("src:approve on a dedup proposal blocks when the suggested trust_mode would widen an active endpoint's trust", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.20")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 20, target_url: "https://archive.org/details/some-item", status: "submitted", endpoint_id: 7,
            source_proposal_intents: [{ reason: "specific item", suggested_trust_mode: "domain_trusted", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("source_endpoints?id=eq.7")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ trust_mode: "item_verified", status: "active" }]) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    await POST(req(telegramUpdate("src:approve:20")));

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.equal(rpcCall, undefined, "must not silently widen an already-active endpoint's trust_mode");
    const answered = calls.find((c) => c.url.includes("answerCallbackQuery"));
    assert.ok(answered, "must acknowledge the tap");
    assert.equal(answered!.body.show_alert, true);
    assert.match(answered!.body.text, /fiducia|trust/i);
  });

  await t.test("src:approve on a dedup proposal blocks when the existing endpoint isn't active", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.21")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 21, target_url: "https://archive.org/details/other-item", status: "submitted", endpoint_id: 8,
            source_proposal_intents: [{ reason: "specific item", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("source_endpoints?id=eq.8")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ trust_mode: "item_verified", status: "suspended" }]) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    await POST(req(telegramUpdate("src:approve:21")));

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.equal(rpcCall, undefined, "must not one-tap resolve onto a non-active endpoint");
    const answered = calls.find((c) => c.url.includes("answerCallbackQuery"));
    assert.equal(answered!.body.show_alert, true);
  });

  await t.test("src:approve on a dedup proposal proceeds when the suggested trust_mode matches the active endpoint's", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.22")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 22, target_url: "https://archive.org/details/same-item", status: "submitted", endpoint_id: 9,
            source_proposal_intents: [{ reason: "specific item", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("source_endpoints?id=eq.9")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ trust_mode: "item_verified", status: "active" }]) } as any;
      }
      if (url.includes("human_principals?email=eq.")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 9, proposal_id: 22, status: "resolved" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await POST(req(telegramUpdate("src:approve:22")));
    assert.equal(res.status, 200);

    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.ok(rpcCall, "no real trust change -- must proceed same as today");
    assert.equal(rpcCall!.body.p_trust_mode, "item_verified");
  });

  await t.test("src:approve on a brand-new proposal (no endpoint_id) proceeds without checking source_endpoints", async () => {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.23")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 23, target_url: "https://newdomain.example/", status: "submitted", endpoint_id: null,
            source_proposal_intents: [{ reason: "brand new domain", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("human_principals?email=eq.")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 10, proposal_id: 23, status: "resolved" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await POST(req(telegramUpdate("src:approve:23")));
    assert.equal(res.status, 200);

    assert.equal(calls.some((c) => c.url.includes("source_endpoints?id=eq.")), false,
      "no endpoint_id -- nothing to check on source_endpoints");
    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.ok(rpcCall, "new endpoint -- must proceed same as today");
  });

  await t.test("still returns 200 when the resolution succeeds but acknowledging Telegram fails", async () => {
    // A resolved governance decision must never turn into a 500 just because
    // the callback query expired before the ack landed — a 500 makes
    // Telegram retry the update, and the retry would hit an already-resolved
    // proposal rather than lose the decision, but there's no reason to make
    // Telegram do that dance when the actual work already succeeded.
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as any).url;
      if (url.includes("api.telegram.org")) {
        return { ok: false, status: 400, json: async () => ({ ok: false, description: "query is too old" }) } as any;
      }
      if (url.includes("source_proposals?id=eq.12")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 12, target_url: "https://ctext.org/", status: "submitted",
            source_proposal_intents: [{ reason: "x", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("human_principals?email=eq.")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 6, proposal_id: 12, status: "resolved" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await POST(req(telegramUpdate("src:approve:12")));
    assert.equal(res.status, 200, "the RPC succeeded — the failing ack must not surface as a request failure");
  });

  await t.test("callback from a chat other than TELEGRAM_CHAT_ID is ignored when the chat is configured", async () => {
    process.env.TELEGRAM_CHAT_ID = "555";
    try {
      const calls: { url: string; body: any }[] = [];
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input as any).url;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      };

      // telegramUpdate() puts the callback in chat.id 999, which doesn't
      // match the configured 555.
      const res = await POST(req(telegramUpdate("src:approve:12")));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
      assert.equal(calls.length, 0, "an unauthorized chat must not even get an answerCallbackQuery");
    } finally {
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });

  await t.test("callback from the configured TELEGRAM_CHAT_ID proceeds as normal", async () => {
    process.env.TELEGRAM_CHAT_ID = "999";
    try {
      const calls: { url: string; body: any }[] = [];
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input as any).url;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, body });
        if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
        if (url.includes("source_proposals?id=eq.12")) {
          return {
            ok: true, status: 200,
            text: async () => JSON.stringify([{
              id: 12, target_url: "https://ctext.org/", status: "submitted",
              source_proposal_intents: [{ reason: "classical texts", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
            }]),
          } as any;
        }
        if (url.includes("human_principals?email=eq.")) {
          return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
        }
        if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 11, proposal_id: 12, status: "resolved" }) } as any;
        }
        return { ok: false, status: 404, text: async () => "unexpected" } as any;
      };

      const res = await POST(req(telegramUpdate("src:approve:12")));
      assert.equal(res.status, 200);
      const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
      assert.ok(rpcCall, "the matching chat must resolve exactly as it did before TELEGRAM_CHAT_ID existed");
    } finally {
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });

  await t.test("callback proceeds as normal when TELEGRAM_CHAT_ID isn't configured at all", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as any).url;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes("api.telegram.org")) return { ok: true, json: async () => ({ ok: true, result: {} }) } as any;
      if (url.includes("source_proposals?id=eq.12")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{
            id: 12, target_url: "https://ctext.org/", status: "submitted",
            source_proposal_intents: [{ reason: "classical texts", suggested_trust_mode: "item_verified", suggested_rights_class: "mixed" }],
          }]),
        } as any;
      }
      if (url.includes("human_principals?email=eq.")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }]) } as any;
      }
      if (url.includes("/rest/v1/rpc/mcp_resolve_source_proposal")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ decision_id: 12, proposal_id: 12, status: "resolved" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "unexpected" } as any;
    };

    const res = await POST(req(telegramUpdate("src:approve:12")));
    assert.equal(res.status, 200);
    const rpcCall = calls.find((c) => c.url.includes("mcp_resolve_source_proposal"));
    assert.ok(rpcCall, "no TELEGRAM_CHAT_ID configured -- must not block, same as before this fix");
  });
});
