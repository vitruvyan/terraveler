import { test } from "node:test";
import assert from "node:assert/strict";

test("desk demand counts and queues retain old pending work beyond 1000 rows", async (t) => {
  process.env.EDITOR_EMAIL = "editor@example.com";
  process.env.POSTGREST_URL = "https://data.example.invalid";
  process.env.POSTGREST_SERVICE_KEY = "fixture";
  process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
  process.env.SUPABASE_AUTH_KEY = "fixture";
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const submissions = Array.from({ length: 1208 }, (_, i) => ({
    id: i + 1, status: ["appealed", "human-review", "peer-review", "human-review"][i] ?? "approved",
    type: "suggestion", payload: {}, contributor_id: 1,
  }));
  const audit = submissions.map((s) => ({
    id: s.id, submission_id: s.id, findings: s.id === 3 || s.id === 4 ? [["ESCALATE", 0, "read this"]] : [],
  }));
  // The old escalation was resolved; both endpoints must use the newest audit.
  audit.push({ id: 1209, submission_id: 4, findings: [] });
  const gaps = Array.from({ length: 1005 }, (_, i) => ({ id: i + 1, status: "claimed" }));
  const pagedPaths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    const table = url.pathname.split("/").pop();
    const all = table === "submissions" ? submissions : table === "audit_log" ? audit : table === "editorial_gaps" ? gaps : [];
    const order = url.searchParams.get("order") ?? "";
    const rows = order.includes("id.desc") ? [...all].reverse() : all;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    if (url.searchParams.has("offset")) pagedPaths.push(url.toString());
    // Emulate a backend row cap smaller than our requested page size.
    return Response.json(rows.slice(offset, offset + Math.min(limit, 137)));
  };
  const { GET: overview } = await import("../app/api/desk/overview/route");
  const { GET: queue } = await import("../app/api/desk/submissions/route");
  const { GET: claims } = await import("../app/api/desk/claims/route");
  const request = () => new Request("https://terraveler.example/desk", { headers: { cookie: "desk_token=fixture" } });
  const countsResponse = await overview(request());
  assert.equal(countsResponse.status, 200);
  const { counts } = await countsResponse.json();
  const queueResponse = await queue(request());
  assert.equal(queueResponse.status, 200);
  const grouped = await queueResponse.json();
  const rows = Object.values(grouped).flat() as { id: number; status: string; escalated: boolean }[];
  assert.equal(rows.length, submissions.length);
  assert.equal(counts.appealed, 1);
  assert.equal(counts.appealed, rows.filter(s => s.status === "appealed").length);
  assert.equal(counts.submissions["human-review"], 2);
  assert.equal(counts.submissions["human-review"], rows.filter(s => s.status === "human-review").length);
  assert.equal(counts.escalations, 1);
  assert.equal(counts.escalations, rows.filter(s => s.escalated && ["submitted", "peer-review", "human-review"].includes(s.status)).length);
  assert.deepEqual(grouped.needs_verdict.map((s: { id: number }) => s.id), [4, 3, 2, 1]);
  assert.equal(counts.gaps.claimed, 1005);
  const claimsResponse = await claims(request());
  assert.equal(claimsResponse.status, 200);
  assert.equal((await claimsResponse.json()).claims.length, counts.gaps.claimed);
  assert.ok(pagedPaths.some(path => path.includes("offset=1096")));
  const callsBefore = pagedPaths.length;
  assert.equal((await queue(new Request("https://terraveler.example/desk"))).status, 401);
  assert.equal(pagedPaths.length, callsBefore, "unauthenticated requests must not read the queue");
});
