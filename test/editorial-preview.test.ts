import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { readEditorialPreview, safeSourceHref } from "../lib/editorialPreview";
import { coordinatorContext } from "../lib/editorialCoordinator";

const paragraph = 'A source-grounded account <script>alert("unsafe")</script>.';
const draft = {
  kind: "draft", title: "Voyage <img src=x onerror=alert(1)>",
  body: `${paragraph}\n\nA second paragraph.\n\nAn unmapped paragraph.`,
  citations: [
    { claim: paragraph, source_id: "source-a" }, { claim: paragraph, source_id: "source-a" },
    { claim: paragraph, source_id: "unknown" },
    { claim: "A second paragraph.", source_id: "source-b" },
  ],
  references: [
    { id: "source-a", title: "Primary account", url: "https://archive.example/account", rights: "public domain", text: "SECRET_SOURCE_PASSAGE", governance: { secret: "PRIVATE_POLICY" } },
    { id: "source-b", title: "Unsafe source address", url: "javascript:alert(1)", rights: "CC BY-SA" },
  ], candidate: { token: "SECRET_MODEL_ENVELOPE" },
};
const waypoints = [
  { id: "galveston", sequence: 2, place_historical: "Malhado", place_modern: "Galveston Island, Texas",
    latitude: 29.3, longitude: -94.8, arrival_date: "1528-11", departure_date: null,
    date_note: "The month is approximate.", event: "The survivors reach an island off the coast.",
    coordinate_note: "Candidate island location; the identification remains disputed.", source_ids: ["source-a"],
    confidence: "approximate", uncertainty: "The historical place identification is not certain." },
  { id: "florida", sequence: 1, place_historical: "Florida coast", place_modern: null,
    latitude: 27.9, longitude: -82.5, arrival_date: "1528", departure_date: "1528",
    date_note: null, event: "Landfall after the Atlantic crossing.", coordinate_note: "Regional landing candidate.",
    source_ids: ["source-a"], confidence: "certain", uncertainty: null },
];
function fixture(review: unknown = { kind: "review", verdict: "changes-requested", issues: ["Clarify the date."] }, route?: unknown[]) {
  const paths: string[] = [];
  return { paths, read: async (method: string, path: string) => {
    assert.equal(method, "GET"); paths.push(path);
    if (path.startsWith("editorial_topics?")) return [{ id: 7, title: "Voyage dossier" }];
    if (path.includes("role=eq.writer")) return [{ id: 41, task_id: 19, created_at: "2026-11-16T18:00:00Z", result: route === undefined ? draft : { ...draft, waypoints: route } }];
    if (path.includes("role=eq.reviewer")) return review ? [{ result: review }] : [];
    throw new Error(`Unexpected query: ${path}`);
  } };
}

test("private preview selects the immutable result within its dossier and attaches only that writer's review", async () => {
  const { paths, read } = fixture();
  const value = await readEditorialPreview(7, 41, read);
  assert.ok(value);
  assert.equal(value.result_id, 41); assert.equal(value.task_id, 19);
  assert.equal(value.review?.verdict, "changes-requested");
  const writer = paths.find(p => p.includes("role=eq.writer"))!;
  assert.match(writer, /editorial_tasks\.topic_id=eq\.7(?:&|$)/);
  assert.match(writer, /&id=eq\.41(?:&|$)/);
  const review = paths.find(p => p.includes("role=eq.reviewer"))!;
  assert.match(review, /editorial_tasks\.topic_id=eq\.7(?:&|$)/);
  assert.match(review, /editorial_tasks\.dependency_id=eq\.19(?:&|$)/);
  assert.doesNotMatch(JSON.stringify(value), /SECRET_SOURCE_PASSAGE|SECRET_MODEL_ENVELOPE|PRIVATE_POLICY|governance|candidate/);
  assert.deepEqual(value.paragraphs.map(p => p.source_ids), [["source-a"], ["source-b"], []]);
});

test("latest preview is explicit and missing dossiers or committed drafts remain absent", async () => {
  const { paths, read } = fixture(null);
  const value = await readEditorialPreview(7, null, read);
  assert.equal(value?.review, null);
  const writer = paths.find(p => p.includes("role=eq.writer"))!;
  assert.match(writer, /order=id\.desc&limit=1/); assert.doesNotMatch(writer, /&id=eq\./);
  let queries = 0;
  assert.equal(await readEditorialPreview(7, null, async () => { queries++; return []; }), null);
  assert.equal(queries, 1, "a missing dossier does not query global draft data");
  assert.equal(await readEditorialPreview(7, 41, async (_method, path) => path.startsWith("editorial_topics?") ? [{ id: 7, title: "Dossier" }] : []), null);
});

test("preview rejects malformed identities before reaching the data plane and fails closed on malformed drafts", async () => {
  let reads = 0;
  const read = async () => { reads++; return []; };
  for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    await assert.rejects(readEditorialPreview(id, 41, read), /Invalid preview identity/);
    await assert.rejects(readEditorialPreview(7, id, read), /Invalid preview identity/);
  }
  assert.equal(reads, 0);
  await assert.rejects(readEditorialPreview(7, 41, async (_method, path) => path.startsWith("editorial_topics?") ? [{ id: 7 }] : [{ id: 41, task_id: 19, result: { kind: "research", title: "Not a draft", body: "Text" } }]), /Invalid draft/);
});

test("preview refuses malformed review readiness instead of showing a false clean review", async () => {
  for (const invalid of [
    { kind: "review", verdict: "ready-for-editor", issues: ["Still unsupported"] },
    { kind: "review", verdict: "blocked", issues: [] },
    { kind: "review", verdict: "published", issues: [] },
  ]) {
    const { read } = fixture(invalid);
    assert.equal((await readEditorialPreview(7, 41, read))?.review, null);
  }
  const { read } = fixture({ kind: "review", verdict: "ready-for-editor", issues: [] });
  assert.equal((await readEditorialPreview(7, 41, read))?.review?.verdict, "ready-for-editor");
});

test("preview source links permit web citations only, without credentials or executable protocols", () => {
  for (const value of [null, 42, "relative/path", "//archive.example/source", "javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "https://user:password@archive.example/source"]) assert.equal(safeSourceHref(value), null);
  assert.equal(safeSourceHref("https://archive.example/source?q=voyage"), "https://archive.example/source?q=voyage");
});

test("preview sorts candidate waypoints, omits malformed records and keeps private fields out", async () => {
  const malformed = [
    waypoints[1], waypoints[0],
    { ...waypoints[0], id: "bad-coordinate", latitude: 91 },
    { ...waypoints[0], id: "bad-source", source_ids: ["unknown"] },
    { ...waypoints[0], id: "bad-date", arrival_date: "1528-02-30" },
    { ...waypoints[0], id: "missing-uncertainty", uncertainty: null },
    { ...waypoints[0], id: "long-note", coordinate_note: "x".repeat(501) },
    { ...waypoints[1], id: "ancient", sequence: 3, arrival_date: "0028-02-29", candidate: "SECRET_MODEL_ENVELOPE" },
  ];
  const value = await readEditorialPreview(7, 41, fixture(undefined, malformed).read);
  assert.deepEqual(value?.waypoints.map(waypoint => waypoint.id), ["florida", "galveston", "ancient"]);
  assert.equal(value?.waypoints_omitted, 5);
  assert.equal(value?.waypoints[2].arrival_date, "0028-02-29");
  assert.doesNotMatch(JSON.stringify(value), /SECRET_SOURCE_PASSAGE|SECRET_MODEL_ENVELOPE|PRIVATE_POLICY|governance/);
  assert.equal("candidate" in value!, false);
  await assert.rejects(readEditorialPreview(7, 41, fixture(undefined, "not-an-array" as unknown as unknown[]).read), /Invalid waypoints/);
});

test("reading edition escapes generated markup, maps paragraph citations and distinguishes missing sections from publication", async () => {
  const require = createRequire(import.meta.url);
  const extensions = require.extensions;
  const previous = extensions[".css"];
  extensions[".css"] = () => {};
  try {
    const EditorialPreview = require("../components/desk/EditorialPreview").default;
    const value = await readEditorialPreview(7, 41, fixture().read);
    assert.ok(value);
    const html = renderToStaticMarkup(React.createElement(EditorialPreview, { preview: value }));
    assert.doesNotMatch(html, /<script>|<img src=x|href="javascript:/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /href="#preview-source-1"/);
    assert.match(html, /id="preview-source-1"/);
    assert.match(html, /No paragraph source mapping recorded/);
    assert.match(html, /Private editorial preview/);
    assert.match(html, /Saved version #41/);
    assert.match(html, /Images and population sections/);
    assert.match(html, /not publication authorization/);
    assert.match(html, /Clarify the date/);

    const routed = await readEditorialPreview(7, 41, fixture(undefined, waypoints).read);
    assert.ok(routed);
    const routeHtml = renderToStaticMarkup(React.createElement(EditorialPreview, { preview: routed }));
    assert.match(routeHtml, /Map of candidate waypoints in this saved draft/);
    assert.match(routeHtml, /27\.90000, -82\.50000/);
    assert.match(routeHtml, /The historical place identification is not certain/);
    assert.match(routeHtml, /id="preview-waypoint-galveston"/);
    assert.match(routeHtml, /not independently verified geography/);
    assert.doesNotMatch(routeHtml, /SECRET_SOURCE_PASSAGE|SECRET_MODEL_ENVELOPE|PRIVATE_POLICY/);
  } finally {
    if (previous) extensions[".css"] = previous; else delete extensions[".css"];
  }
});

test("coordinator receives the inspected version instead of silently substituting the newest draft", () => {
  const context = coordinatorContext({ id: 7, inspected_draft: { result_id: 41, title: "Inspected", body: "a".repeat(17000), candidate: "PRIVATE_RAW" }, latest_draft: { title: "Newer", body: "A different draft" } }, []);
  assert.equal(context.project.inspected_draft?.result_id, 41);
  assert.equal(context.project.inspected_draft?.body.length, 16000);
  assert.equal(context.project.inspected_draft?.truncated, true);
  assert.equal(context.project.latest_draft, null, "newer work does not distract from the inspected version");
  assert.equal(coordinatorContext({ latest_draft: { title: "Newer", body: "A different draft" } }, []).project.latest_draft?.title, "Newer");
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_RAW|candidate/);
});
