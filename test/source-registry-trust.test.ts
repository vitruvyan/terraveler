import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEndpoints,
  isEffective,
  resolveTrust,
  SEED_ENDPOINTS,
  type RegistryRow,
} from "../lib/source-governance";
import {
  ensureRegistry,
  fetchSourceText,
  isAllowedHost,
  isGovernedHost,
  loadRegistryRows,
  resetRegistryCache,
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

  await t.test("a domain_trusted approval needs a KNOWN rights class", () => {
    assert.equal(isEffective(row({ id: 1, host_pattern: "a.example", rights_class: "public_domain" })), true);
    assert.equal(isEffective(row({ id: 2, host_pattern: "b.example", rights_class: "creative_commons" })), true);
    assert.equal(isEffective(row({ id: 3, host_pattern: "c.example", rights_class: "mixed" })), true);
    assert.equal(isEffective(row({ id: 4, host_pattern: "d.example", rights_class: "unknown" })), false,
      "'this whole domain is safe to ingest' cannot rest on 'rights: unknown'");
    assert.equal(isEffective(row({ id: 5, host_pattern: "e.example", rights_class: "in_copyright" })), false);
    assert.equal(isEffective(row({ id: 6, host_pattern: "f.example", rights_class: null })), false,
      "no approval on record means no rights to act on");
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
    assert.ok(!hosts.includes("www.dbnl.org"), "rights unknown → recorded, not live");
    assert.ok(!hosts.includes("globalise.huygens.knaw.nl"), "collection_trusted needs a collection match");
    assert.ok(!hosts.includes("test-governance-verify.example.org"), "retired");
  });

  await t.test("a seed host the registry has quarantined drops out — approval is not a one-way ratchet", () => {
    const rows = [row({ id: 2, host_pattern: "www.gutenberg.org", status: "quarantined" })];
    const hosts = effectiveEndpoints(rows).map((e) => e.host_pattern);
    assert.ok(!hosts.includes("www.gutenberg.org"));
    assert.ok(hosts.includes("gutenberg.org"), "only the named host is revoked");
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

test("ensureRegistry keeps the site's host gates in step with the registry, and fails safe", async (t) => {
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

  await t.test("before any load, only the seed hosts are governed", () => {
    resetRegistryCache();
    assert.equal(isGovernedHost(PARES_URL), false);
    assert.equal(isGovernedHost("https://www.gutenberg.org/x"), true);
  });

  await t.test("after a load, an approved item_verified host is governed but NOT auto-searchable", async () => {
    resetRegistryCache();
    await ensureRegistry(1_000, backend);
    assert.equal(isGovernedHost(PARES_URL), true);
    assert.equal(isAllowedHost(PARES_URL), false, "item_verified never counts as wholesale-trusted");
  });

  await t.test("an approval with unknown rights stays inert", async () => {
    resetRegistryCache();
    await ensureRegistry(1_000, backend);
    assert.equal(isGovernedHost("https://www.dbnl.org/tekst/x"), false);
  });

  await t.test("within the TTL the backend is not asked again", async () => {
    resetRegistryCache();
    let calls = 0;
    const counting = async (p: string) => { calls++; return backend(p); };
    await ensureRegistry(1_000, counting);
    const first = calls;
    await ensureRegistry(1_000 + 30_000, counting);
    assert.equal(calls, first);
    await ensureRegistry(1_000 + 61_000, counting);
    assert.ok(calls > first, "after the TTL it reloads");
  });

  await t.test("a failed reload keeps serving the last good view", async () => {
    resetRegistryCache();
    await ensureRegistry(1_000, backend);
    await ensureRegistry(1_000 + 61_000, async () => { throw new Error("backend down"); });
    assert.equal(isGovernedHost(PARES_URL), true);
  });

  await t.test("a registry that has been failing for ten minutes falls back to the seed floor", async () => {
    resetRegistryCache();
    await ensureRegistry(1_000, backend);
    await ensureRegistry(1_000 + 11 * 60_000, async () => { throw new Error("backend down"); });
    assert.equal(isGovernedHost(PARES_URL), false);
    assert.equal(isGovernedHost("https://www.gutenberg.org/x"), true, "never narrower than the seeds");
  });

  await t.test("a backend that was never reachable does not throw and leaves the seeds", async () => {
    resetRegistryCache();
    await ensureRegistry(1_000, async () => { throw new Error("no backend"); });
    assert.equal(isGovernedHost("https://en.wikipedia.org/wiki/X"), true);
    assert.equal(isGovernedHost(PARES_URL), false);
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
