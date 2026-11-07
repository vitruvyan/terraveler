import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterProjects, loadDeskContent, projectNextStep, projectStatus } from "../lib/deskContent";
import ContentCatalogue from "../components/desk/ContentCatalogue";

const gap = { id: 25, title: "Cabeza de Vaca and Estebanico", description: "Approved scope", kind: "voyage", status: "open", claimed_by: null, claimed_at: null, created_at: "2026-11-07", source_submission_id: 111 };

test("catalogue retains explicit proposal links but does not call completed work published", async () => {
  const data = await loadDeskContent(async () => [gap, { ...gap, id: 26, status: "done", source_submission_id: null }]);
  assert.equal(data.projects[0].source_submission_id, 111);
  assert.equal(data.projects[1].source_submission_id, null);
  assert.match(projectStatus(data.projects[1]), /publication not established/);
  assert.match(projectNextStep(data.projects[1]), /does not prove publication/);
  assert.ok(data.voyages.every((v) => v.href && v.title));
  assert.ok(!data.voyages.some((v) => v.title === gap.title));
  assert.deepEqual(filterProjects(data.projects, "111", "open").map((p) => p.id), [25]);
  assert.equal(filterProjects(data.projects, "Cabeza", "claimed").length, 0);
});

test("only an absent proposal-link column permits the legacy read", async () => {
  const paths: string[] = [];
  const data = await loadDeskContent(async (path) => {
    paths.push(path);
    if (path.includes("source_submission_id")) throw new Error("backend 400: column editorial_gaps.source_submission_id does not exist");
    const { source_submission_id, ...legacy } = gap;
    return [legacy];
  });
  assert.equal(paths.length, 2);
  assert.equal(data.proposalLinksAvailable, false);
  assert.equal(data.projects[0].source_submission_id, null);
  let calls = 0;
  await assert.rejects(loadDeskContent(async () => { calls++; throw new Error("backend 503: unavailable"); }), /503/);
  assert.equal(calls, 1, "an unavailable backend must not become an empty catalogue");
});

test("catalogue makes load failures distinct from no projects", async () => {
  const failed = renderToStaticMarkup(React.createElement(ContentCatalogue, { data: null, loading: false, error: "Could not load catalogue", onRetry() {} }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Retry catalogue/);
  assert.doesNotMatch(failed, /No editorial projects/);
  const empty = renderToStaticMarkup(React.createElement(ContentCatalogue, { data: { projects: [], voyages: [], proposalLinksAvailable: true }, loading: false, error: "" }));
  assert.match(empty, /No editorial projects are recorded/);
  assert.doesNotMatch(empty, /role="alert"/);
});

test("catalogue endpoint enforces editor auth and reads the entire queue", async (t) => {
  process.env.EDITOR_EMAIL = "editor@example.com";
  process.env.POSTGREST_URL = "https://data.example.invalid";
  process.env.POSTGREST_SERVICE_KEY = "fixture";
  process.env.SUPABASE_AUTH_URL = "https://auth.example.invalid";
  process.env.SUPABASE_AUTH_KEY = "fixture";
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let reads = 0;
  const rows = Array.from({ length: 1005 }, (_, i) => ({ ...gap, id: i + 1 }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/v1/user")) return Response.json({ email: "editor@example.com" });
    if (url.pathname.endsWith("/audit_log")) return Response.json([]);
    reads++;
    assert.match(url.pathname, /editorial_gaps$/);
    const offset = Number(url.searchParams.get("offset"));
    return Response.json(rows.slice(offset, offset + 137));
  };
  const { GET } = await import("../app/api/desk/content/route");
  assert.equal((await GET(new Request("https://terraveler.example/api/desk/content"))).status, 401);
  assert.equal(reads, 0);
  const response = await GET(new Request("https://terraveler.example/api/desk/content", { headers: { cookie: "desk_token=fixture" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projects.length, 1005);
  assert.ok(reads > 2);
});
