import test from "node:test";
import assert from "node:assert/strict";
import { fetchWikipediaOutline, normalizeWikipediaOutline } from "../lib/wikipediaOutline";
import { MAX_FETCHED_TEXT_CHARS, resetRegistryCache, setRegistryRequiredForTest } from "../lib/sourceSearch";

function parse() {
  return { parse: { revid: 123, title: "Example voyage",
    sections: [{ index: "1", level: "2", line: "<i>Early life</i>", anchor: "Early_life" }],
    externallinks: ["https://archive.org/details/example", "https://archive.org/details/example", "javascript:alert(1)", "https://user:secret@example.org/"],
    text: { "*": "<h2>Early life</h2><p>A sourced orientation paragraph.</p>" } } };
}
test("orientation binds headings, body and candidate links to one explicit revision", () => {
  const value = normalizeWikipediaOutline("https://en.wikipedia.org/wiki/Example_voyage", parse(), "2026-11-16T20:00:00Z");
  assert.equal(value.revision_id, 123);
  assert.equal(value.revision_url, "https://en.wikipedia.org/w/index.php?oldid=123");
  assert.equal(value.sections[0].title, "Early life");
  assert.deepEqual(value.external_links_candidates, ["https://archive.org/details/example"]);
  assert.equal(value.purpose, "planning-only");
  assert.match(value.notice, /not a persisted MCP consultation receipt/);
  assert.match(value.snapshot_sha256, /^[a-f0-9]{64}$/);
  const again = normalizeWikipediaOutline(value.requested_url, parse(), "2026-11-17T20:00:00Z");
  assert.equal(value.snapshot_sha256, again.snapshot_sha256, "retrieval time is not part of snapshot fidelity");
  const changed = parse(); changed.parse.revid = 124;
  assert.notEqual(value.snapshot_sha256, normalizeWikipediaOutline(value.requested_url, changed, again.retrieved_at).snapshot_sha256);
});
test("outline and source-text coverage limits are separate and explicit", () => {
  const payload = parse();
  payload.parse.text["*"] = "x".repeat(MAX_FETCHED_TEXT_CHARS + 1);
  payload.parse.sections = Array.from({length:201}, (_, i) => ({index:String(i + 1),level:"2",line:"Section",anchor:String(i)}));
  const value = normalizeWikipediaOutline("https://en.wikipedia.org/wiki/Example", payload, "2026-11-16");
  assert.equal(value.text.length, MAX_FETCHED_TEXT_CHARS);
  assert.equal(value.total_text_length, MAX_FETCHED_TEXT_CHARS + 1);
  assert.equal(value.text_truncated, true);
  assert.equal(value.sections.length, 200); assert.equal(value.sections_truncated, true);
});
test("missing revision, incomplete parse and empty body cannot become successful orientation", () => {
  for (const payload of [{}, {error:{code:"missingtitle"}}, {parse:{...parse().parse,revid:0}}, {parse:{...parse().parse,sections:null}}, {parse:{...parse().parse,text:{"*":""}}}])
    assert.throws(() => normalizeWikipediaOutline("https://en.wikipedia.org/wiki/Example", payload, "2026-11-16"));
});
test("MCP primitive uses one governed parse request and never fetches bibliography candidates", async () => {
  const old = globalThis.fetch; const calls: string[] = [];
  resetRegistryCache(); setRegistryRequiredForTest(false);
  globalThis.fetch = async input => { calls.push(String(input)); return Response.json(parse()); };
  try {
    const value = await fetchWikipediaOutline("https://en.wikipedia.org/wiki/Example");
    assert.equal(value.revision_id, 123); assert.equal(calls.length, 1);
    const url = new URL(calls[0]); assert.equal(url.hostname, "en.wikipedia.org");
    assert.equal(url.pathname, "/w/api.php");
    assert.equal(url.searchParams.get("prop"), "sections|text|revid|externallinks");
  } finally { globalThis.fetch = old; resetRegistryCache(); setRegistryRequiredForTest(false); }
});
test("invalid destinations fail before any source request", async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("unexpected network"); };
  try {
    for (const url of ["http://en.wikipedia.org/wiki/Example", "https://evil.example/wiki/Example", "https://en.wikipedia.org.evil.example/wiki/Example", "https://user:secret@en.wikipedia.org/wiki/Example", "https://en.wikipedia.org/w/api.php", "https://en.wikipedia.org/wiki/Example?oldid=123", "https://en.wikipedia.org/wiki/Example#Section", "https://en.wikipedia.org/wiki/%00"])
      await assert.rejects(fetchWikipediaOutline(url));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = old; }
});
