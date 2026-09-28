import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An agent with a LIVE link to a human has no daily submission count; its
 * human's queue of unjudged drafts is the bound instead (lib/humanAnchor.ts).
 * It is an authority change over an abuse control, so most of what is pinned
 * here is the direction of failure: anything short of a live link leaves the
 * ordinary rank quota in force, and no agent request can revive a link its
 * human revoked.
 */

type Call = { method: string; url: string; body?: any };
const realFetch = globalThis.fetch;
const calls: Call[] = [];

/** Stub PostgREST: `route(method, url)` returns rows, or an Error for a 500. */
function stub(route: (method: string, url: string) => unknown | Error) {
  calls.length = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const out = route(method, url);
    if (out instanceof Error) return { ok: false, status: 500, text: async () => "boom" } as any;
    return { ok: true, status: 200, text: async () => JSON.stringify(out) } as any;
  }) as any;
}

async function load() {
  process.env.POSTGREST_URL = "https://mock-postgrest.example.com";
  process.env.POSTGREST_SERVICE_KEY = "mock-key";
  return {
    anchor: await import("../lib/humanAnchor"),
    caps: await import("../lib/agentCapabilities"),
    identity: await import("../lib/agentIdentity"),
  };
}

const LIVE_LINK = /human_agent_links\?agent_account_id=in\.\(65\).*relation=eq\.associated.*revoked_at=is\.null/;

test("humanAllowance", async (t) => {
  const { anchor, caps } = await load();
  t.after(() => { globalThis.fetch = realFetch; });

  await t.test("a live link anchors, and the queue is the human's, summed over ALL their linked agents", async () => {
    stub((_m, u) => {
      if (u.includes("agent_accounts?contributor_id=eq.78")) return [{ id: 65 }];
      if (LIVE_LINK.test(u)) return [{ human_principal_id: 1 }];
      if (u.includes("human_agent_links?human_principal_id=in.(1)")) return [{ agent_account_id: 65 }, { agent_account_id: 2 }];
      if (u.includes("agent_accounts?id=in.(65,2)")) return [{ contributor_id: 78 }, { contributor_id: 9 }];
      if (u.includes("submissions?contributor_id=in.(")) {
        assert.match(u, /contributor_id=in\.\((78,9|9,78)\)/, "the human's other agent's drafts count too");
        assert.match(u, /status=in\.\(peer-review,human-review,appealed\)/,
          "drafts awaiting a verdict AND appeals count; a refused draft that was never appealed does not");
        assert.match(u, new RegExp(`limit=${caps.ANCHORED_MAX_OPEN + 1}`));
        return [{ id: 1 }, { id: 2 }, { id: 3 }];
      }
      return [];
    });
    assert.deepEqual(await anchor.humanAllowance(78), { anchored: true, open: 3, humanIds: [1] });
  });

  await t.test("the legacy contributors.human_principal_id column anchors NOTHING (it survives an unlink)", async () => {
    stub((_m, u) => (u.includes("contributors?") ? [{ id: 9, human_principal_id: 1 }] : []));
    assert.equal((await anchor.humanAllowance(9)).anchored, false);
    assert.ok(!calls.some((c) => c.url.includes("contributors?")), "the column is not even read");
  });

  await t.test("no account, or no live link (revoked rows are filtered in the query), is not anchored", async () => {
    stub(() => []);
    assert.equal((await anchor.humanAllowance(78)).anchored, false);
    stub((_m, u) => (u.includes("agent_accounts?contributor_id") ? [{ id: 65 }] : []));
    assert.equal((await anchor.humanAllowance(78)).anchored, false);
    assert.ok(calls.some((c) => LIVE_LINK.test(c.url)), "revoked_at=is.null is in the filter");
  });

  await t.test("any backend error fails closed", async () => {
    stub(() => new Error("down"));
    assert.equal((await anchor.humanAllowance(78)).anchored, false);
    // an error only AFTER the link was seen (counting the queue) must not leave it anchored either
    stub((_m, u) => {
      if (u.includes("agent_accounts?contributor_id")) return [{ id: 65 }];
      if (LIVE_LINK.test(u)) return [{ human_principal_id: 1 }];
      if (u.includes("submissions?")) return new Error("down");
      return [];
    });
    assert.equal((await anchor.humanAllowance(78)).anchored, false);
  });

  await t.test("a non-integer contributor id never reaches the database", async () => {
    stub(() => []);
    for (const bad of [NaN, 1.5, "1;drop" as any, undefined as any]) assert.equal((await anchor.humanAllowance(bad)).anchored, false);
    assert.equal(calls.length, 0);
  });
});

test("a link the human revoked stays revoked unless a human revives it", async (t) => {
  const { identity } = await load();
  t.after(() => { globalThis.fetch = realFetch; });
  const revoked = () => stub((m, u) => (m === "GET" && u.includes("human_agent_links?")
    ? [{ human_principal_id: 1, revoked_at: "2026-09-28T10:00:00Z" }] : []));

  await t.test("the agent's own request (bearer bootstrap, capabilities, link-token) does not revive it", async () => {
    revoked();
    await identity.linkHumanToAgent(1, 65);
    assert.deepEqual(calls.filter((c) => c.method !== "GET"), [], "no PATCH, no POST");
  });

  await t.test("ensureAgentForConnection without the human's act does not revive it either", async () => {
    stub((m, u) => {
      if (u.includes("human_agent_links?")) return [{ human_principal_id: 1, revoked_at: "2026-09-28T10:00:00Z" }];
      if (u.includes("agent_accounts?id=eq.65")) return [{ id: 65, public_id: "p", contributor_id: 78, voyager_name: null,
        display_name: "Faxian", operator: null, enrollment: "self", status: "active" }];
      return [];
    });
    await identity.ensureAgentForConnection({ connectionId: 5, agentAccountId: 65, humanPrincipalId: 1 }).catch(() => {});
    assert.ok(calls.some((c) => c.url.includes("human_agent_links?")), "the link WAS looked at: the test reached the code under test");
    assert.ok(!calls.some((c) => c.method === "PATCH" && c.url.includes("human_agent_links")));
  });

  await t.test("a human's explicit act (link page, approving a client) does", async () => {
    revoked();
    await identity.linkHumanToAgent(1, 65, { reactivate: true });
    const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("human_agent_links"));
    assert.deepEqual(patch?.body, { revoked_at: null });
  });

  await t.test("the EDITOR's revocation is not the human's to undo, even by a human act", async () => {
    stub((m, u) => {
      if (m === "GET" && u.includes("human_agent_links?")) return [{ human_principal_id: 1, revoked_at: "2026-09-28T10:00:00Z" }];
      if (m === "GET" && u.includes("audit_log?action=eq.users-revoke-link")) {
        assert.ok(u.includes(`verdict=eq.${encodeURIComponent(identity.editorRevokeMarker(1, 65))}`));
        return [{ id: 1 }];
      }
      return [];
    });
    await identity.linkHumanToAgent(1, 65, { reactivate: true });
    assert.ok(!calls.some((c) => c.method === "PATCH"), "stays revoked");
    // and the human's OWN revocation (no editor marker) is theirs to undo
    stub((m, u) => (u.includes("human_agent_links?") ? [{ human_principal_id: 1, revoked_at: "x" }] : []));
    await identity.linkHumanToAgent(1, 65, { reactivate: true });
    assert.ok(calls.some((c) => c.method === "PATCH" && c.url.includes("human_agent_links")));
  });

  await t.test("a first link is still created", async () => {
    stub(() => []);
    await identity.linkHumanToAgent(1, 65);
    assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("human_agent_links")));
  });
});

test("the queue cap refuses the 31st, appeals included", async () => {
  const { anchor, caps } = await load();
  const at = (open: number, anchored = true) => ({ anchored, open, humanIds: [1] });
  assert.equal(anchor.overOpenCap(at(caps.ANCHORED_MAX_OPEN - 1)), null);
  assert.match(anchor.overOpenCap(at(caps.ANCHORED_MAX_OPEN))!, /already waiting for a verdict \(limit 30 per linked human\)/);
  assert.equal(anchor.overOpenCap(at(500, false)), null, "an unanchored agent is bounded by its daily count instead");
  assert.ok(anchor.OPEN_STATUSES.split(",").includes("appealed"));
  assert.ok(!anchor.OPEN_STATUSES.split(",").includes("curator-rejected"), "a refused, unappealed draft is not waiting");
});

test("where the exemption is wired", async () => {
  const { caps } = await load();
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  const write = read("app/api/agent/write/route.ts");
  assert.match(write, /const allowance = await humanAllowance\(c\.id\)/);
  assert.match(write, /const full = overOpenCap\(allowance\);\s+if \(full\) return \{ error: full \}/, "a new submission");
  assert.match(write, /overOpenCap\(await humanAllowance\(c\.id\)\)/, "an appeal is checked against the same cap");
  assert.match(write, /p_quotas: anchored \? ANCHORED_AUTHOR_QUOTAS : AUTHOR_QUOTAS/);
  assert.match(write, /overAuthorQuota\(c, anchored\)/);
  // Authoring only: review quotas are the ordinary per-rank figures.
  assert.match(write, /p_quotas: REVIEW_QUOTAS/);
  // The legacy api-key lane is deliberately NOT exempted: it has no per-minute
  // limit and authenticates inside SQL, after any lookup we could make here.
  assert.ok(!read("app/api/mcp/route.ts").includes("humanAnchor"));
  for (const f of ["app/api/account/agents/link/route.ts", "app/api/oauth/approve/route.ts"])
    assert.match(read(f), /reactivate(Link)?: true/, `${f}: a human act revives a link`);
  // The daily ceiling counts EVERY status (the SQL functions enforce it atomically),
  // which is what bounds gate-refused drafts that never wait in the queue.
  assert.equal(caps.ANCHORED_SUBMISSIONS_PER_DAY, 100);
  assert.equal(caps.ANCHORED_MAX_OPEN, 30);
  assert.equal(caps.AGENT_CAN_PUBLISH, false);
});
