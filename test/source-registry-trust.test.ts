import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEndpoints,
  effectiveMode,
  isEffective,
  isWellFormedPattern,
  resolveTrust,
  SEED_ENDPOINTS,
  type RegistryRow,
} from "../lib/source-governance";
import {
  ensureRegistry,
  fetchSourceText,
  getGovernedText,
  isAllowedHost,
  isGovernedHost,
  loadRegistryRows,
  redirectStaysGoverned,
  registryUnavailable,
  resetRegistryCache,
  searchSources,
  setRegistryRequiredForTest,
} from "../lib/sourceSearch";

const row = (over: Partial<RegistryRow> & Pick<RegistryRow, "id" | "host_pattern">): RegistryRow => ({
  institution_id: null,
  match_type: "exact",
  status: "active",
  trust_mode: "domain_trusted",
  rights_class: "public_domain",
  ...over,
});

const PARES = row({ id: 21, host_pattern: "pares.cultura.gob.es", trust_mode: "item_verified", rights_class: "mixed" });

test("an approval only takes effect when it is safe to act on", async (t) => {
  await t.test("an active item_verified approval is effective — the host is governed, the item is verified later", () => {
    assert.equal(isEffective(PARES), true);
  });

  await t.test("a domain_trusted approval with UNKNOWN rights is in force — per item, not wholesale", () => {
    for (const rights of ["public_domain", "creative_commons", "mixed", "unknown"] as const)
      assert.equal(isEffective(row({ id: 1, host_pattern: "a.example", rights_class: rights })), true, rights);
    assert.equal(isEffective(row({ id: 5, host_pattern: "e.example", rights_class: "in_copyright" })), false);
    assert.equal(isEffective(row({ id: 6, host_pattern: "f.example", rights_class: null })), false,
      "no approval on record means nothing in force");
  });

  await t.test("effectiveMode: wholesale trust needs known rights; unknown rights downgrade to per-item", () => {
    assert.equal(effectiveMode(row({ id: 1, host_pattern: "a.example", rights_class: "public_domain" })), "domain_trusted");
    assert.equal(effectiveMode(row({ id: 2, host_pattern: "b.example", rights_class: "mixed" })), "domain_trusted");
    assert.equal(effectiveMode(row({ id: 3, host_pattern: "c.example", rights_class: "unknown" })), "item_verified");
    assert.equal(effectiveMode({ ...PARES }), "item_verified");
  });

  await t.test("an item_verified approval must still be IN FORCE and not in_copyright", () => {
    assert.equal(isEffective({ ...PARES, rights_class: null }), false, "no approval in force (no decision, or newest is not an approve)");
    assert.equal(isEffective({ ...PARES, rights_class: "in_copyright" }), false);
    assert.equal(isEffective({ ...PARES, rights_class: "unknown" }), true,
      "item_verified establishes rights per item, so an endpoint-level 'unknown' is not disqualifying");
  });

  await t.test("a pattern that is not a well-formed hostname is inert, whatever else is true", () => {
    for (const bad of ["a@b.com", "x?y.com", "evil.com/path", "com", "", "UPPER.com", "-a.com", "host:8080.com"])
      assert.equal(isEffective({ ...PARES, host_pattern: bad }), false, JSON.stringify(bad));
  });

  await t.test("a suffix row must be a dot plus at least two labels — 'com' would trust every .com host", () => {
    for (const bad of ["com", ".com", "", "wikisource.org", ".org.", ".a..b"])
      assert.equal(isWellFormedPattern("suffix", bad), false, JSON.stringify(bad));
    assert.equal(isWellFormedPattern("suffix", ".wikisource.org"), true);
    assert.equal(isEffective(row({ id: 40, host_pattern: "com", match_type: "suffix" })), false);
    assert.equal(isEffective(row({ id: 41, host_pattern: "", match_type: "suffix" })), false);
    assert.equal(isEffective(row({ id: 42, host_pattern: ".example.org", match_type: "suffix" })), true);
  });

  await t.test("collection_trusted and link_only are never honoured by host alone", () => {
    assert.equal(isEffective(row({ id: 7, host_pattern: "g.example", trust_mode: "collection_trusted", rights_class: "creative_commons" })), false);
    assert.equal(isEffective(row({ id: 8, host_pattern: "h.example", trust_mode: "link_only", rights_class: "public_domain" })), false);
    assert.equal(isEffective(row({ id: 9, host_pattern: "i.example", trust_mode: null })), false);
  });

  await t.test("only active endpoints, whatever else is true", () => {
    for (const status of ["retired", "quarantined", "needs_human_review", "rejected", "proposed"] as const)
      assert.equal(isEffective({ ...PARES, status }), false, status);
  });
});

test("effectiveEndpoints: the seed floor plus effective approvals, with revocation", async (t) => {
  await t.test("an empty registry leaves exactly the seeds — never narrower than the hardcoded whitelist", () => {
    assert.deepEqual(effectiveEndpoints([]).map((e) => e.host_pattern), SEED_ENDPOINTS.map((e) => e.host_pattern));
  });

  await t.test("an effective approval is added; an ineffective one is not", () => {
    const rows = [
      PARES,
      row({ id: 11, host_pattern: "www.dbnl.org", rights_class: "unknown" }),
      row({ id: 20, host_pattern: "globalise.huygens.knaw.nl", trust_mode: "collection_trusted", rights_class: "creative_commons" }),
      row({ id: 10, host_pattern: "test-governance-verify.example.org", status: "retired", trust_mode: "item_verified", rights_class: "mixed" }),
    ];
    const hosts = effectiveEndpoints(rows).map((e) => e.host_pattern);
    assert.ok(hosts.includes("pares.cultura.gob.es"));
    assert.ok(hosts.includes("www.dbnl.org"), "rights unknown → in force, per item (not left inert)");
    const dbnl = resolveTrust("https://www.dbnl.org/tekst/x", effectiveEndpoints(rows))!;
    assert.equal(dbnl.endpoint.trust_mode, "item_verified", "and never wholesale trust");
    assert.ok(!hosts.includes("globalise.huygens.knaw.nl"), "collection_trusted needs a collection match");
    assert.ok(!hosts.includes("test-governance-verify.example.org"), "retired");
  });

  await t.test("a seed host the registry has quarantined drops out — approval is not a one-way ratchet", () => {
    const rows = [row({ id: 2, host_pattern: "www.gutenberg.org", status: "quarantined" })];
    const hosts = effectiveEndpoints(rows).map((e) => e.host_pattern);
    assert.ok(!hosts.includes("www.gutenberg.org"));
    assert.ok(hosts.includes("gutenberg.org"), "only the named host is revoked");
  });

  await t.test("the registry's trust mode governs a seed: downgrading .wikimedia.org to link_only takes it out of fetching", () => {
    const rows = [row({ id: 7, host_pattern: ".wikimedia.org", match_type: "suffix", trust_mode: "link_only", rights_class: "mixed" })];
    const eps = effectiveEndpoints(rows);
    assert.equal(resolveTrust("https://upload.wikimedia.org/x.jpg", eps), null);
    assert.ok(resolveTrust("https://en.wikipedia.org/wiki/X", eps), "other seeds untouched");
  });

  await t.test("a seed the registry marks in_copyright, or leaves with no trust mode, is dropped", () => {
    assert.equal(resolveTrust("https://runeberg.org/x",
      effectiveEndpoints([row({ id: 4, host_pattern: "runeberg.org", rights_class: "in_copyright" })])), null);
    assert.equal(resolveTrust("https://runeberg.org/x",
      effectiveEndpoints([row({ id: 4, host_pattern: "runeberg.org", trust_mode: null })])), null);
  });

  await t.test("a seed re-stated as item_verified keeps its host but loses wholesale trust", () => {
    const eps = effectiveEndpoints([row({ id: 4, host_pattern: "runeberg.org", trust_mode: "item_verified", rights_class: "mixed" })]);
    assert.equal(resolveTrust("https://runeberg.org/x", eps)!.endpoint.trust_mode, "item_verified");
  });

  await t.test("a seed host keeps wholesale trust even if its live row says rights 'unknown' (search must not lose gutenberg)", () => {
    const eps = effectiveEndpoints([row({ id: 2, host_pattern: "www.gutenberg.org", rights_class: "unknown" })]);
    assert.equal(resolveTrust("https://www.gutenberg.org/ebooks/1", eps)!.endpoint.trust_mode, "domain_trusted");
  });

  await t.test("a seed host is never duplicated by its own registry row", () => {
    const rows = [row({ id: 1, host_pattern: "gutenberg.org" })];
    const hosts = effectiveEndpoints(rows).map((e) => e.host_pattern);
    assert.equal(hosts.filter((h) => h === "gutenberg.org").length, 1);
  });

  await t.test("resolution uses exact-host matching: a lookalike is not the approved host", () => {
    const eps = effectiveEndpoints([PARES]);
    assert.ok(resolveTrust("https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/123928", eps));
    assert.equal(resolveTrust("https://pares.cultura.gob.es.attacker.example/x", eps), null);
    assert.equal(resolveTrust("https://evilpares.cultura.gob.es/x", eps), null);
  });
});

const fakeBackend = (endpoints: any[], decisions: any[]) => async (path: string) => {
  if (path.startsWith("source_endpoints")) return endpoints;
  if (path.startsWith("source_policy_decisions")) return decisions;
  throw new Error(`unexpected path ${path}`);
};

test("loadRegistryRows joins each endpoint to the rights on its NEWEST decision", async (t) => {
  const endpoints = [
    { id: 21, institution_id: null, host_pattern: "pares.cultura.gob.es", match_type: "exact", status: "active", trust_mode: "item_verified" },
    { id: 12, institution_id: null, host_pattern: "dl.ndl.go.jp", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
  ];

  await t.test("the newest approval's rights class is used", async () => {
    const decisions = [
      { endpoint_id: 21, decision_outcome: "approve", rights_class: "mixed" },
      { endpoint_id: 21, decision_outcome: "approve", rights_class: "unknown" }, // older
    ];
    const rows = await loadRegistryRows(fakeBackend(endpoints, decisions));
    assert.equal(rows.find((r) => r.id === 21)!.rights_class, "mixed");
  });

  await t.test("a newer reject leaves no rights to act on, even after an older approve", async () => {
    const decisions = [
      { endpoint_id: 12, decision_outcome: "reject", rights_class: "unknown" }, // newest (query is newest-first)
      { endpoint_id: 12, decision_outcome: "approve", rights_class: "public_domain" },
    ];
    const rows = await loadRegistryRows(fakeBackend(endpoints, decisions));
    assert.equal(rows.find((r) => r.id === 12)!.rights_class, null);
  });

  await t.test("an endpoint with no decision at all has null rights", async () => {
    const rows = await loadRegistryRows(fakeBackend(endpoints, []));
    assert.ok(rows.every((r) => r.rights_class === null));
  });
});

test("ensureRegistry keeps the site's host gates in step with the registry, and fails CLOSED", async (t) => {
  const PARES_URL = "https://pares.cultura.gob.es/ParesBusquedas20/catalogo/description/123928";
  const backend = fakeBackend(
    [
      { id: 21, institution_id: null, host_pattern: "pares.cultura.gob.es", match_type: "exact", status: "active", trust_mode: "item_verified" },
      { id: 11, institution_id: null, host_pattern: "www.dbnl.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
    ],
    [
      { endpoint_id: 21, decision_outcome: "approve", rights_class: "mixed" },
      { endpoint_id: 11, decision_outcome: "approve", rights_class: "unknown" },
    ],
  );
  const reset = () => { resetRegistryCache(); setRegistryRequiredForTest(false); };

  await t.test("with no backend configured, the seed hosts are the whole authority", () => {
    reset();
    assert.equal(registryUnavailable(), false);
    assert.equal(isGovernedHost(PARES_URL), false);
    assert.equal(isGovernedHost("https://www.gutenberg.org/x"), true);
  });

  await t.test("after a load, an approved item_verified host is governed but NOT auto-searchable", async () => {
    reset();
    await ensureRegistry(1_000, backend);
    assert.equal(isGovernedHost(PARES_URL), true);
    assert.equal(isAllowedHost(PARES_URL), false, "item_verified never counts as wholesale-trusted");
  });

  await t.test("an approval with unknown rights is governed per item, and never auto-searchable as wholesale trust", async () => {
    reset();
    await ensureRegistry(1_000, backend);
    assert.equal(isGovernedHost("https://www.dbnl.org/tekst/x"), true);
    assert.equal(isAllowedHost("https://www.dbnl.org/tekst/x"), false);
  });

  await t.test("within the TTL the backend is not asked again", async () => {
    reset();
    let calls = 0;
    const counting = async (p: string) => { calls++; return backend(p); };
    await ensureRegistry(1_000, counting);
    const first = calls;
    await ensureRegistry(1_000 + 30_000, counting);
    assert.equal(calls, first);
    await ensureRegistry(1_000 + 61_000, counting);
    assert.ok(calls > first, "after the TTL it reloads");
  });

  await t.test("concurrent callers share ONE read", async () => {
    reset();
    let calls = 0;
    const counting = async (p: string) => { calls++; await new Promise((r) => setTimeout(r, 20)); return backend(p); };
    await Promise.all([1, 2, 3, 4, 5].map(() => ensureRegistry(1_000, counting)));
    assert.equal(calls, 2, "one read of endpoints + one of decisions, however many callers");
  });

  await t.test("a failed reload keeps serving the last good view", async () => {
    reset();
    setRegistryRequiredForTest(true);
    await ensureRegistry(1_000, backend);
    await ensureRegistry(1_000 + 61_000, async () => { throw new Error("backend down"); });
    assert.equal(isGovernedHost(PARES_URL), true);
    assert.equal(registryUnavailable(), false);
    reset();
  });

  await t.test("a backend that answers with an error object instead of rows is a failed read, not an empty registry", async () => {
    reset();
    setRegistryRequiredForTest(true);
    await ensureRegistry(1_000, async () => ({ message: "permission denied", code: "42501" }));
    assert.equal(registryUnavailable(), true);
    reset();
  });

  await t.test("a configured registry that has been unreadable for ten minutes governs NOTHING — it does not fall back to hosts it may have revoked", async () => {
    reset();
    setRegistryRequiredForTest(true);
    await ensureRegistry(1_000, backend);
    await ensureRegistry(1_000 + 11 * 60_000, async () => { throw new Error("backend down"); });
    assert.equal(registryUnavailable(), true);
    assert.equal(isGovernedHost("https://www.gutenberg.org/x"), false, "closed, not the seed floor");
    assert.equal(isGovernedHost(PARES_URL), false);
    reset();
  });

  await t.test("a configured registry that was never readable governs nothing, and fetch/search say why", async () => {
    reset();
    setRegistryRequiredForTest(true);
    await ensureRegistry(1_000, async () => { throw new Error("no backend"); });
    assert.equal(isGovernedHost("https://en.wikipedia.org/wiki/X"), false);
    await assert.rejects(() => fetchSourceText("https://en.wikipedia.org/wiki/X", "wikipedia"), /cannot be read right now/);
    await assert.rejects(() => searchSources("anything", "en", 5, []), /cannot be read right now/);
    reset();
  });

  await t.test("a backend that never answers costs a bounded wait, not the request", async () => {
    reset();
    setRegistryRequiredForTest(true);
    const started = Date.now();
    await ensureRegistry(1_000, () => new Promise(() => {}), 40);
    assert.ok(Date.now() - started < 1_000, "must return once the timeout passes");
    assert.equal(registryUnavailable(), true);
    reset();
  });

  reset();
});

test("a redirect is re-checked against what is governed, hop by hop", async (t) => {
  const backend = fakeBackend(
    [
      { id: 1, institution_id: 1, host_pattern: "gutenberg.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
      { id: 2, institution_id: 1, host_pattern: "www.gutenberg.org", match_type: "exact", status: "quarantined", trust_mode: "domain_trusted" },
      { id: 8, institution_id: 4, host_pattern: "archive.org", match_type: "exact", status: "active", trust_mode: "item_verified" },
    ],
    [
      { endpoint_id: 1, decision_outcome: "approve", rights_class: "public_domain" },
      { endpoint_id: 2, decision_outcome: "approve", rights_class: "public_domain" },
      { endpoint_id: 8, decision_outcome: "approve", rights_class: "mixed" },
    ],
  );
  resetRegistryCache();
  await ensureRegistry(Date.now(), backend);

  const respond = (status: number, location?: string, body = "text") =>
    ({ status, ok: status >= 200 && status < 300,
       headers: { get: (k: string) => (k.toLowerCase() === "location" ? location ?? null : null) },
       text: async () => body }) as unknown as Response;

  await t.test("quarantining www.gutenberg.org stops the apex from reaching it through its own redirect", async () => {
    const fetchImpl = (async (u: any) =>
      String(u).startsWith("https://gutenberg.org/")
        ? respond(301, "https://www.gutenberg.org/files/1/1.txt")
        : respond(200, undefined, "book")) as unknown as typeof fetch;
    await assert.rejects(() => getGovernedText("https://gutenberg.org/files/1/1.txt", fetchImpl), /not a governed source/);
  });

  await t.test("a redirect to an attacker host is refused before it is requested", async () => {
    let requested: string[] = [];
    const fetchImpl = (async (u: any) => { requested.push(String(u)); return respond(302, "https://evil.example/x"); }) as unknown as typeof fetch;
    await assert.rejects(() => getGovernedText("https://gutenberg.org/x", fetchImpl), /evil\.example.*not a governed source/);
    assert.deepEqual(requested, ["https://gutenberg.org/x"]);
  });

  await t.test("a downgrade to plain http is refused", () => {
    assert.equal(redirectStaysGoverned("https://gutenberg.org/x", "http://gutenberg.org/y"), false);
    assert.equal(redirectStaysGoverned("https://gutenberg.org/x", "https://user:pw@gutenberg.org/y"), false);
  });

  await t.test("archive.org's own CDN nodes are followed, an unrelated .archive.org.evil host is not", async () => {
    assert.equal(redirectStaysGoverned("https://archive.org/download/x/x.txt", "https://ia800808.us.archive.org/1/items/x/x.txt"), true);
    assert.equal(redirectStaysGoverned("https://archive.org/download/x/x.txt", "https://archive.org.evil.example/x"), false);
    assert.equal(redirectStaysGoverned("https://gutenberg.org/x", "https://ia800808.us.archive.org/x"), false,
      "the CDN allowance is archive.org to archive.org only");
  });

  await t.test("redirect loops end", async () => {
    const fetchImpl = (async () => respond(302, "https://gutenberg.org/again")) as unknown as typeof fetch;
    await assert.rejects(() => getGovernedText("https://gutenberg.org/x", fetchImpl), /too many redirects/);
  });

  await t.test("a plain 200 is returned as is", async () => {
    const fetchImpl = (async () => respond(200, undefined, "the text")) as unknown as typeof fetch;
    assert.equal(await getGovernedText("https://gutenberg.org/x", fetchImpl), "the text");
  });

  resetRegistryCache();
});

test("a fetch kind only runs against its own site, however many hosts are governed", async (t) => {
  const backend = fakeBackend(
    [{ id: 14, institution_id: null, host_pattern: "ctext.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" }],
    [{ endpoint_id: 14, decision_outcome: "approve", rights_class: "public_domain" }],
  );
  resetRegistryCache();
  // Real clock, not a fixture one: fetchSourceText refreshes the registry
  // itself with Date.now(), and a view "loaded" in 1970 would be discarded
  // as stale before the kind check ever ran.
  await ensureRegistry(Date.now(), backend);
  assert.equal(isGovernedHost("https://ctext.org/analects"), true, "precondition: the newly approved host is governed");

  await t.test("kind=gutenberg refuses a governed non-gutenberg host before any request", async () => {
    await assert.rejects(() => fetchSourceText("https://ctext.org/analects", "gutenberg"), /not a gutenberg\.org host/);
  });
  await t.test("kind=archive refuses a governed non-archive.org host before any request", async () => {
    await assert.rejects(() => fetchSourceText("https://ctext.org/analects", "archive"), /not an archive\.org host/);
  });
  resetRegistryCache();
});
