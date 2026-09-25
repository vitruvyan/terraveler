import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTER_FNS, AdapterRejected, DEFAULT_CANDIDATE_CAP, MAX_FETCHED_TEXT_CHARS,
  fetchSourceText, filterActiveAdapters, isAllowedHost, isGovernedHost,
  mediawikiSearch, searchSources, wikisourceRenderToText,
  type AdapterRow, type Candidate,
} from "../lib/sourceSearch";

/**
 * Phase 3: the agent-facing discovery + fetch path (`search_sources`,
 * `fetch_source_text`), ported from `ingest/oculus.py` / `source_registry.py`
 * / `fetch.py`. These tests pin the same invariants
 * `ingest/test_source_registry.py` pins on the Python side — a misconfigured
 * adapter row (or a bare URL) can only ever shrink what gets searched or
 * fetched, never smuggle a request past the whitelist; an unrecognized
 * `kind` must raise, never silently fall back to a different source — plus
 * the new port-specific surface: the Wikisource transclusion fix and the
 * PostgREST-shaped `source_search_adapters`/`source_endpoints` join.
 *
 * Deliberately offline: every network call an assertion cares about is
 * either avoided entirely (a rejection must happen BEFORE any request) or
 * stubbed via `global.fetch`, so this suite runs the same in CI as on a
 * machine with no DB and no internet — real-network verification against
 * live Gutendex/Wikimedia/PostgREST was done by hand (see the Phase 3
 * handoff) and is not repeated here.
 */

function row(overrides: Partial<AdapterRow>): AdapterRow {
  return {
    id: 1, adapter: "mediawiki_search", config: {}, capability: "search",
    priority: 100, max_candidates: 5, endpoint_id: null, institution_id: null,
    notes: null, ...overrides,
  };
}

function withStubbedFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = global.fetch;
  global.fetch = impl;
  return fn().finally(() => { global.fetch = orig; });
}

function throwingFetch(msg: string): typeof fetch {
  return (async () => { throw new Error(msg); }) as typeof fetch;
}

test("domain gates mirror whitelist.is_allowed() / the broader governed-host check", async (t) => {
  await t.test("gutenberg, wikipedia and wikisource are domain_trusted (isAllowedHost)", () => {
    assert.equal(isAllowedHost("https://www.gutenberg.org/cache/epub/1/pg1.txt"), true);
    assert.equal(isAllowedHost("https://en.wikisource.org/wiki/X"), true);
    assert.equal(isAllowedHost("https://ja.wikipedia.org/wiki/X"), true);
  });

  await t.test("archive.org is governed but NOT domain_trusted — matches whitelist.py's docstring exactly", () => {
    assert.equal(isAllowedHost("https://archive.org/details/x"), false);
    assert.equal(isGovernedHost("https://archive.org/details/x"), true);
  });

  await t.test("an off-whitelist host is neither", () => {
    assert.equal(isAllowedHost("https://evil.example.com/x"), false);
    assert.equal(isGovernedHost("https://evil.example.com/x"), false);
  });

  await t.test("suffix rule is not a substring rule (the same trap whitelist.py guards)", () => {
    assert.equal(isGovernedHost("https://wikisource.org.attacker.example/x"), false);
    assert.equal(isAllowedHost("https://notwikisource.org/x"), false);
  });
});

test("mediawiki_search: a misconfigured adapter row can only shrink discovery, never widen it", async (t) => {
  await t.test("an off-whitelist api_base_template is rejected before any request", async () => {
    const config = { api_base_template: "https://evil.example.com/w/api.php", kind: "evil", license: "stolen" };
    await assert.rejects(
      () => withStubbedFetch(
        throwingFetch("mediawiki_search must never make an HTTP request for an off-whitelist host"),
        () => mediawikiSearch("Magellan", "en", config, 5),
      ),
      (err: any) => {
        assert.ok(err instanceof AdapterRejected);
        assert.match(err.message, /evil\.example\.com/);
        return true;
      },
    );
  });

  await t.test("a subdomain lookalike does not pass (the same trap for a raw URL)", async () => {
    const config = { api_base_template: "https://{lang}.wikipedia.org.evil.example/w/api.php", kind: "wikipedia", license: "CC BY-SA 4.0" };
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must not fetch"), () => mediawikiSearch("Magellan", "en", config, 5)),
      AdapterRejected,
    );
  });

  await t.test("a path-traversal lang is refused before any request", async () => {
    const config = { api_base_template: "https://{lang}.wikipedia.org/w/api.php", kind: "wikipedia", license: "CC BY-SA 4.0" };
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must not fetch"), () => mediawikiSearch("Magellan", "../../evil", config, 5)),
      (err: any) => { assert.ok(err instanceof AdapterRejected); assert.match(err.message, /lang/); return true; },
    );
  });

  await t.test("an @-injection lang is refused before any request", async () => {
    const config = { api_base_template: "https://{lang}.wikipedia.org/w/api.php", kind: "wikipedia", license: "CC BY-SA 4.0" };
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must not fetch"), () => mediawikiSearch("Magellan", "x@evil.com", config, 5)),
      AdapterRejected,
    );
  });
});

test("searchSources: pooling, priority ordering and the total cap", async (t) => {
  await t.test("candidates are capped after merging by priority, matching Python's split exactly", async () => {
    const fake = async (_subject: string, lang: string, config: any, _max: number): Promise<Candidate[]> =>
      Array.from({ length: config.n }, (_, i) => ({
        kind: config.kind, lang, title: `${config.kind}-${i}`, hint: "x", license: "x",
        url: "x", source_url: "x", adapter: "fake",
      }));
    ADAPTER_FNS.fake = fake;
    try {
      const lowPriority = row({ id: 1, adapter: "fake", priority: 1, max_candidates: 15, config: { n: 15, kind: "first" } });
      const highPriority = row({ id: 2, adapter: "fake", priority: 2, max_candidates: 15, config: { n: 15, kind: "second" } });
      const found = await searchSources("X", "en", 20, [lowPriority, highPriority]);
      assert.equal(found.candidates.length, 20);
      assert.equal(found.candidates.filter((c) => c.kind === "first").length, 15);
      assert.equal(found.candidates.filter((c) => c.kind === "second").length, 5);
      assert.deepEqual(found.dropped_by_cap, { fake: 10 });
    } finally {
      delete ADAPTER_FNS.fake;
    }
  });

  await t.test("DEFAULT_CANDIDATE_CAP is the named constant, verified against oculus.py (24)", () => {
    assert.equal(DEFAULT_CANDIDATE_CAP, 24);
  });

  await t.test("an adapter name with no registered function is reported, not fatal", async () => {
    const found = await searchSources("Magellan", "en", 24, [row({ id: 5, adapter: "some_future_adapter_not_built_yet" })]);
    assert.deepEqual(found.candidates, []);
    assert.deepEqual(found.adapters_unimplemented, ["some_future_adapter_not_built_yet"]);
  });

  await t.test("a verify_only capability row is never run as a search adapter", async () => {
    const found = await searchSources("Magellan", "en", 24, [row({ id: 6, adapter: "archive_org_metadata", capability: "verify_only" })]);
    assert.deepEqual(found.candidates, []);
    assert.deepEqual(found.adapters_used, []);
  });

  await t.test("a rejection becomes zero candidates and one named failure, not a thrown error out of searchSources", async () => {
    const evil = row({ id: 99, adapter: "mediawiki_search", priority: 1, config: { api_base_template: "https://evil.example.com/w/api.php", kind: "evil", license: "stolen" } });
    const found = await withStubbedFetch(throwingFetch("must not fetch"), () => searchSources("Magellan", "en", 24, [evil]));
    assert.deepEqual(found.candidates, []);
    assert.equal(found.adapters_failed.length, 1);
    assert.equal(found.adapters_failed[0].adapter, "mediawiki_search");
    assert.match(found.adapters_failed[0].why, /evil\.example\.com/);
  });

  await t.test("every candidate carries adapter provenance", async () => {
    const fake = async (): Promise<Candidate[]> => [
      { kind: "gutenberg", lang: "en", title: "T", hint: "h", license: "Public domain", url: "u", source_url: "s", adapter: "gutendex" },
    ];
    ADAPTER_FNS.fakeProv = fake;
    try {
      const found = await searchSources("X", "en", 24, [row({ id: 1, adapter: "fakeProv" })]);
      assert.equal(found.candidates[0].adapter, "gutendex");
    } finally {
      delete ADAPTER_FNS.fakeProv;
    }
  });
});

test("filterActiveAdapters mirrors load_adapters()'s SQL exists(...) join", async (t) => {
  await t.test("endpoint_id row kept only when THAT endpoint is active", () => {
    const endpoints = [{ id: 5, institution_id: null }];
    const adapters = [
      { id: 1, adapter: "a", config: {}, capability: "search", priority: 1, max_candidates: 5, endpoint_id: 5, institution_id: null, notes: null },
      { id: 2, adapter: "b", config: {}, capability: "search", priority: 1, max_candidates: 5, endpoint_id: 6, institution_id: null, notes: null },
    ];
    const out = filterActiveAdapters(endpoints, adapters);
    assert.deepEqual(out.map((a) => a.id), [1]);
  });

  await t.test("institution_id row kept when the institution owns ANY active endpoint", () => {
    const endpoints = [{ id: 1, institution_id: 3 }];
    const adapters = [{ id: 9, adapter: "gutendex", config: {}, capability: "search", priority: 10, max_candidates: 3, endpoint_id: null, institution_id: 3, notes: null }];
    const out = filterActiveAdapters(endpoints, adapters);
    assert.deepEqual(out.map((a) => a.id), [9]);
  });

  await t.test("institution_id row dropped when its institution has no active endpoint", () => {
    const endpoints: any[] = [];
    const adapters = [{ id: 9, adapter: "gutendex", config: {}, capability: "search", priority: 10, max_candidates: 3, endpoint_id: null, institution_id: 3, notes: null }];
    assert.deepEqual(filterActiveAdapters(endpoints, adapters), []);
  });

  await t.test("matches the real production roster shape (4 rows in, 3 search adapters survive)", () => {
    const endpoints = [
      { id: 1, institution_id: 1 }, { id: 2, institution_id: 1 }, { id: 3, institution_id: 1 },
      { id: 4, institution_id: 2 }, { id: 5, institution_id: 3 }, { id: 6, institution_id: 3 },
      { id: 7, institution_id: 3 }, { id: 8, institution_id: 4 }, { id: 9, institution_id: 4 },
    ];
    const adapters = [
      { id: 1, adapter: "gutendex", config: {}, capability: "search", priority: 10, max_candidates: 3, endpoint_id: null, institution_id: 1, notes: null },
      { id: 2, adapter: "mediawiki_search", config: { kind: "wikisource" }, capability: "search", priority: 20, max_candidates: 8, endpoint_id: 5, institution_id: null, notes: null },
      { id: 3, adapter: "mediawiki_search", config: { kind: "wikipedia" }, capability: "search", priority: 20, max_candidates: 8, endpoint_id: 6, institution_id: null, notes: null },
      { id: 4, adapter: "archive_org_metadata", config: {}, capability: "verify_only", priority: 90, max_candidates: 0, endpoint_id: null, institution_id: 4, notes: null },
    ];
    const out = filterActiveAdapters(endpoints, adapters);
    assert.deepEqual(out.map((a) => a.id).sort(), [1, 2, 3, 4]);
  });
});

test("wikisourceRenderToText: the transclusion fix's HTML->text reduction", async (t) => {
  await t.test("style/script are stripped WHOLESALE, not just their tags", () => {
    const html = '<style>.mw-parser-output .wst-header{color:red}</style><p>Real text.</p>';
    const text = wikisourceRenderToText(html);
    assert.doesNotMatch(text, /mw-parser-output|wst-header|color:red/);
    assert.match(text, /Real text\./);
  });

  await t.test("<br> becomes a newline, block-close tags become a paragraph break", () => {
    const html = "<p>Line one<br>Line two</p><p>Second paragraph</p>";
    const text = wikisourceRenderToText(html);
    assert.equal(text, "Line one\nLine two\n\nSecond paragraph");
  });

  await t.test("HTML entities are decoded and zero-width spaces are dropped", () => {
    const html = "<p>Cook&#039;s Journal ​&mdash; a &quot;true&quot; account</p>";
    const text = wikisourceRenderToText(html);
    assert.equal(text, 'Cook\'s Journal — a "true" account');
  });

  await t.test("no residual tags or entities survive on a realistic fragment", () => {
    const html = `
      <style>.foo{display:none}</style>
      <div class="header">Captain Cook&#8217;s Journal</div>
      <p>During his <i>first</i> voyage.<br>Made in H.M. Bark &quot;Endeavour&quot;.</p>
    `;
    const text = wikisourceRenderToText(html);
    assert.doesNotMatch(text, /<[a-z]/i);
    assert.doesNotMatch(text, /&[a-zA-Z#][a-zA-Z0-9]*;/);
    assert.match(text, /Captain Cook.s Journal/);
    assert.match(text, /Made in H\.M\. Bark "Endeavour"\./);
  });
});

test("fetch_source_text: dispatch, whitelist gate and truncation", async (t) => {
  await t.test("an unrecognized kind raises instead of silently defaulting to another fetcher", async () => {
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must never fetch for an unknown kind"),
        () => fetchSourceText("https://www.gutenberg.org/files/1/1.txt", "wikisource_typo")),
      /no fetcher registered for kind="wikisource_typo"/,
    );
  });

  await t.test("an off-whitelist url is refused with zero HTTP requests", async () => {
    let called = false;
    await assert.rejects(
      () => withStubbedFetch((async (...args: any[]) => { called = true; throw new Error("must not fetch"); }) as typeof fetch,
        () => fetchSourceText("https://evil.example.com/x.txt", "gutenberg")),
      /not an active Terraveler source endpoint/,
    );
    assert.equal(called, false);
  });

  await t.test("kind=wikipedia against a non-wikipedia host is refused (no cross-kind host confusion)", async () => {
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must not fetch"),
        () => fetchSourceText("https://www.gutenberg.org/files/1/1.txt", "wikipedia")),
      /not a wikipedia\.org host/,
    );
  });

  await t.test("a lang argument inconsistent with the url's own host is refused", async () => {
    await assert.rejects(
      () => withStubbedFetch(throwingFetch("must not fetch"),
        () => fetchSourceText("https://en.wikisource.org/wiki/X", "wikisource", "fr")),
      /does not match host/,
    );
  });

  await t.test("truncation is reported, never silent", async () => {
    const big = "x".repeat(MAX_FETCHED_TEXT_CHARS + 500);
    const fakeFetch = (async () => new Response(big, { status: 200 })) as typeof fetch;
    const out = await withStubbedFetch(fakeFetch, () => fetchSourceText("https://archive.org/download/x/x_djvu.txt", "archive"));
    assert.equal(out.truncated, true);
    assert.equal(out.total_length, big.length);
    assert.equal(out.text.length, MAX_FETCHED_TEXT_CHARS);
  });

  await t.test("a short text is returned whole and marked not truncated", async () => {
    const fakeFetch = (async () => new Response("short text", { status: 200 })) as typeof fetch;
    const out = await withStubbedFetch(fakeFetch, () => fetchSourceText("https://archive.org/download/x/x_djvu.txt", "archive"));
    assert.equal(out.truncated, false);
    assert.equal(out.text, "short text");
    assert.equal(out.total_length, 10);
  });
});

test("stripGutenbergBoilerplate ordering (via fetchSourceText, kind=gutenberg)", async (t) => {
  await t.test("licence boilerplate before START and after END is both cut, in the tail-before-head order", async () => {
    const raw = "PREAMBLE JUNK\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nREAL BODY TEXT\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nTRAILING LICENCE JUNK";
    const fakeFetch = (async () => new Response(raw, { status: 200 })) as typeof fetch;
    const out = await withStubbedFetch(fakeFetch, () => fetchSourceText("https://www.gutenberg.org/files/1/1.txt", "gutenberg"));
    assert.equal(out.text, "REAL BODY TEXT");
  });
});
