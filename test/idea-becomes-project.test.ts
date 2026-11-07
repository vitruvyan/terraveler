import { test } from "node:test";
import assert from "node:assert/strict";

// Proposal #111 (Cabeza de Vaca) was approved and then vanished: approval
// changed a status and nothing else. These tests pin the repair — approving an
// idea creates exactly one Ongoing Project, linked to it, and a failure there
// never undoes the editor's ruling.

type Call = { method: string; url: string; body: any };
let originalFetch: typeof globalThis.fetch;
let resolveVerdict: any;
let projectDescription: any;

const IDEA = {
  type: "idea",
  status: "human-review",
  contributor_id: 81,
  payload: {
    title: "Cabeza de Vaca and Estebanico: From Conquest to Survival (1527–1536)",
    description: "Scope, candidate Spanish sources, rights checks.",
    kind: "voyage",
  },
};

function mock(opts: { existingGap?: boolean; gapInsertFails?: boolean }, calls: Call[]) {
  globalThis.fetch = async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const reply = (data: unknown, status = 200) =>
      ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data }) as any;

    if (url.includes("editorial_gaps?source_submission_id=")) {
      return reply(opts.existingGap ? [{ id: 25 }] : []);
    }
    if (url.includes("editorial_gaps") && method === "POST") {
      return opts.gapInsertFails ? reply({ message: "boom" }, 500) : reply([{ id: 25 }]);
    }
    if (url.includes("submissions?id=eq.111&type=eq.idea")) return reply([IDEA]);
    if (url.includes("submissions?id=eq.111&select=status,type,contributor_id")) return reply([IDEA]);
    if (url.includes("submissions?id=eq.111") && method === "PATCH") return reply([{ id: 111, status: "approved" }]);
    return reply([]);
  };
}

test("approving an idea creates its Ongoing Project", async (t) => {
  t.before(async () => {
    process.env.POSTGREST_URL = "https://mock-postgrest.example.com";
    process.env.POSTGREST_SERVICE_KEY = "mock-key";
    originalFetch = globalThis.fetch;
    resolveVerdict = (await import("../lib/deskVerdict")).resolveVerdict;
    projectDescription = (await import("../lib/ideaProject")).projectDescription;
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  await t.test("creates one linked project and says so in the audit trail", async () => {
    const calls: Call[] = [];
    mock({}, calls);
    const r = await resolveVerdict(111, "approve");
    assert.equal(r.ok, true);

    const gap = calls.find((c) => c.method === "POST" && c.url.includes("editorial_gaps"));
    assert.ok(gap, "an editorial_gaps row must be created");
    assert.equal(gap!.body.source_submission_id, 111);
    assert.equal(gap!.body.status, "open");
    assert.equal(gap!.body.kind, "voyage");
    assert.equal(gap!.body.initiated_by_contributor_id, 81);
    assert.match(gap!.body.title, /Cabeza de Vaca/);
    assert.match(gap!.body.description, /Approved proposal #111/);
    assert.match(gap!.body.description, /candidates until a draft verifies/);

    const audit = calls.find((c) => c.method === "POST" && c.url.includes("audit_log"));
    const finding = (audit!.body.findings as any[]).find((f) => f[0] === "PROJECT");
    assert.ok(finding, "the audit trail must name the project");
    assert.match(finding[2], /#25/);
    assert.match(finding[2], /claim_gap \{ gap_id: 25 \}/);
  });

  await t.test("a second approval reuses the project instead of duplicating it", async () => {
    const calls: Call[] = [];
    mock({ existingGap: true }, calls);
    const r = await resolveVerdict(111, "approve");
    assert.equal(r.ok, true);
    assert.equal(calls.some((c) => c.method === "POST" && c.url.includes("editorial_gaps")), false);
  });

  await t.test("a failure creating the project never undoes the ruling", async () => {
    const calls: Call[] = [];
    mock({ gapInsertFails: true }, calls);
    const r = await resolveVerdict(111, "approve");
    assert.equal(r.ok, true, "the verdict stands");
    const audit = calls.find((c) => c.method === "POST" && c.url.includes("audit_log"));
    assert.ok((audit!.body.findings as any[]).some((f) => f[0] === "PROJECT-NOT-CREATED"));
  });

  await t.test("rejecting an idea creates no project", async () => {
    const calls: Call[] = [];
    mock({}, calls);
    await resolveVerdict(111, "reject");
    assert.equal(calls.some((c) => c.url.includes("editorial_gaps")), false);
  });

  await t.test("description keeps the proposal text and labels sources as candidates", () => {
    const d = projectDescription(111, { description: "Primary: Relación (1542)." });
    assert.match(d, /^Approved proposal #111/);
    assert.match(d, /Primary: Relación \(1542\)\./);
  });
});
