import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An agent anchored to a human has no daily submission quota (lib/humanAnchor.ts).
 * The exemption is an authority change, so what pins it here is mostly its
 * failure direction: anything short of a live link — no account, a revoked link,
 * an unreadable backend, a malformed handle — leaves the ordinary rank quota
 * in force.
 */

type Route = (url: string) => unknown | Error;
const realFetch = globalThis.fetch;
function stub(route: Route) {
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const out = route(url);
    if (out instanceof Error) return { ok: false, status: 500, text: async () => "boom" } as any;
    return { ok: true, status: 200, text: async () => JSON.stringify(out) } as any;
  }) as any;
}

async function load() {
  process.env.POSTGREST_URL = "https://mock-postgrest.example.com";
  process.env.POSTGREST_SERVICE_KEY = "mock-key";
  return import("../lib/humanAnchor");
}

test("isHumanAnchored", async (t) => {
  const { isHumanAnchored, isHumanAnchoredHandle } = await load();
  t.after(() => { globalThis.fetch = realFetch; });

  await t.test("a legacy contributor with a human principal is anchored", async () => {
    stub((u) => (u.includes("contributors?id=eq.9&human_principal_id=not.is.null") ? [{ id: 9 }] : []));
    assert.equal(await isHumanAnchored(9), true);
  });

  await t.test("an agent account with a live link is anchored", async () => {
    stub((u) => {
      if (u.includes("contributors?id=eq.78")) return [];
      if (u.includes("agent_accounts?contributor_id=eq.78")) return [{ id: 65 }];
      if (u.includes("human_agent_links?agent_account_id=in.(65)")) {
        assert.match(u, /relation=eq\.associated/);
        assert.match(u, /revoked_at=is\.null/, "a revoked link must not count");
        return [{ human_principal_id: 1 }];
      }
      return [];
    });
    assert.equal(await isHumanAnchored(78), true);
  });

  await t.test("no account, or no live link, is not anchored", async () => {
    stub((u) => (u.includes("agent_accounts") ? [] : []));
    assert.equal(await isHumanAnchored(78), false);
    stub((u) => (u.includes("agent_accounts") ? [{ id: 65 }] : []));
    assert.equal(await isHumanAnchored(78), false);
  });

  await t.test("an unreadable backend fails closed", async () => {
    stub(() => new Error("down"));
    assert.equal(await isHumanAnchored(78), false);
    assert.equal(await isHumanAnchoredHandle("scribe-e5b3595b0844"), false);
  });

  await t.test("a malformed handle never reaches the database", async () => {
    let called = false;
    stub(() => { called = true; return []; });
    for (const bad of ["", "a", "x y", "../etc", "a".repeat(40), "h;drop", "é-é-é"])
      assert.equal(await isHumanAnchoredHandle(bad), false, bad);
    assert.equal(called, false);
  });

  await t.test("a handle resolves to its contributor, then the same rule applies", async () => {
    stub((u) => {
      if (u.includes("contributors?handle=eq.claude-desktop")) return [{ id: 9 }];
      if (u.includes("contributors?id=eq.9&human_principal_id")) return [{ id: 9 }];
      return [];
    });
    assert.equal(await isHumanAnchoredHandle("claude-desktop"), true);
  });
});

test("the figure and both lanes", async () => {
  const caps = await import("../lib/agentCapabilities");
  assert.equal(caps.submissionsPerDayFor("cabin-boy", false), 3, "an unlinked cabin-boy keeps the ordinary quota");
  assert.equal(caps.submissionsPerDayFor("cabin-boy", true), caps.ANCHORED_SUBMISSIONS_PER_DAY);
  assert.ok(caps.ANCHORED_SUBMISSIONS_PER_DAY >= 1000, "a circuit breaker, not a working limit");

  const write = readFileSync(join(__dirname, "..", "app/api/agent/write/route.ts"), "utf8");
  assert.match(write, /const anchored = await isHumanAnchored\(c\.id\)/);
  assert.match(write, /p_quotas: anchored \? ANCHORED_AUTHOR_QUOTAS : AUTHOR_QUOTAS/);
  assert.match(write, /overAuthorQuota\(c, anchored\)/);
  const mcp = readFileSync(join(__dirname, "..", "app/api/mcp/route.ts"), "utf8");
  assert.match(mcp, /if \(await isHumanAnchored\(c\.id\)\) return null;/);
  assert.match(mcp, /anchored \? ANCHORED_SUBMISSIONS_PER_DAY/);
  // The exemption is for authoring only: publication and review quotas are untouched.
  assert.match(write, /REVIEW_QUOTAS/);
  assert.equal(caps.AGENT_CAN_PUBLISH, false);
});
