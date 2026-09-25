import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase 4: mechanical gap -> source linkage (list_gaps' related_sources) and
// the geocode_place tool. We dynamically import POST so env vars are set
// before the route module loads (same pattern as governance-api.test.ts).
let POST: any;

type MockFetchType = typeof globalThis.fetch;
let originalFetch: MockFetchType;

const ROUTE_SRC = readFileSync(
  join(__dirname, "../app/api/mcp/route.ts"), "utf8");

// ---- fixtures mirroring the real production data this feature was built
// against: source_policy_decisions.id=18 and source_proposal_intents.id=9
// both name "Gap ID 8" in their reason (approving/proposing the 1916 Hall
// translation of the Cellere Codex for editorial_gaps.id=8, the real
// Verrazzano gap). Gap 105 stands in for a gap nothing references.
const GAPS = [
  {
    id: 8, title: "Verrazzano 1524: a contested letter, and a coast we have barely drawn",
    description: null, kind: "voyage", priority: 2, status: "open",
    waypoint_type: null, claimed_by: null, claimed_at: null,
    context_type: null, context_voyage: null, context_waypoint_seq: null,
    context_place: null, requested_agent_account_id: null,
  },
  {
    id: 105, title: "An unrelated open gap with no governance reference",
    description: null, kind: "waypoint", priority: 3, status: "open",
    waypoint_type: "source", claimed_by: null, claimed_at: null,
    context_type: null, context_voyage: null, context_waypoint_seq: null,
    context_place: null, requested_agent_account_id: null,
  },
];
const DECISIONS = [{
  id: 18,
  reason: "This is the definitive 1916 English translation of the Cellere Codex " +
    "(Giovanni da Verrazzano's 1524 letter describing his voyage along the Atlantic " +
    "coast of North America), prepared by Edward Hagaman Hall. It is a public domain " +
    "primary source that directly resolves the issues in Gap ID 8.",
  decision_outcome: "approve", endpoint_id: 8, collection_id: null, proposal_id: null,
}];
const INTENTS = [{
  id: 9,
  reason: "Public domain primary source that directly resolves the issues in Gap ID 8.",
  proposal_id: 11,
}];
const PROPOSALS = [{
  id: 11, target_url: "https://archive.org/details/verrazanosvoyage00verr",
  endpoint_id: 8, collection_id: null,
}];
const ENDPOINTS = [{ id: 8, host_pattern: "archive.org" }];

function jsonResponse(rows: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(rows) } as any;
}

function mockBackendFetch(input: unknown): Promise<any> {
  const url = new URL(String(typeof input === "string" ? input : (input as any).url));

  if (url.hostname === "mock-supabase.example.com") {
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    const idFilter = url.searchParams.get("id");
    const byId = (rows: any[]) => idFilter?.startsWith("eq.")
      ? rows.filter((r) => r.id === Number(idFilter.slice(3)))
      : rows;

    if (table === "editorial_gaps") {
      const status = url.searchParams.get("status");
      if (status === "eq.open") return Promise.resolve(jsonResponse(GAPS));
      return Promise.resolve(jsonResponse([])); // status=eq.claimed: nothing to reap
    }
    if (table === "source_policy_decisions") return Promise.resolve(jsonResponse(DECISIONS));
    if (table === "source_proposal_intents") return Promise.resolve(jsonResponse(INTENTS));
    if (table === "source_proposals") return Promise.resolve(jsonResponse(byId(PROPOSALS)));
    if (table === "source_endpoints") return Promise.resolve(jsonResponse(byId(ENDPOINTS)));
    if (table === "source_collections") return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse([])); // contributors, oauth_tokens, etc: anonymous call
  }

  if (url.hostname === "www.wikidata.org") {
    if (url.pathname === "/w/api.php") {
      const q = url.searchParams.get("search");
      if (q === "Tahiti") {
        return Promise.resolve({ ok: true, status: 200,
          json: async () => ({ search: [{ id: "Q1440", label: "Tahiti" }] }) } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ search: [] }) } as any);
    }
    if (url.pathname === "/wiki/Special:EntityData/Q1440.json") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        entities: { Q1440: { claims: { P625: [{ mainsnak: { datavalue: { value: {
          latitude: -17.6797, longitude: -149.4068 } } } }] } } },
      }) } as any);
    }
  }

  if (url.hostname === "nominatim.openstreetmap.org" && url.pathname === "/search") {
    const q = url.searchParams.get("q");
    if (q === "Saint-Malo-fallback") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ([
        { lat: "48.6493", lon: "-2.0257", display_name: "Saint-Malo, Ille-et-Vilaine, France" },
      ]) } as any);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ([]) } as any);
  }

  return Promise.resolve({ ok: false, status: 404, text: async () => "not found" } as any);
}

function rpcCall(name: string, args: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function toolResult(res: Response) {
  const body = await res.json();
  assert.ok(!body.error, `unexpected JSON-RPC error: ${JSON.stringify(body.error)}`);
  const text = body.result?.content?.[0]?.text;
  assert.equal(typeof text, "string", `no text content in ${JSON.stringify(body)}`);
  return JSON.parse(text);
}

test("Phase 4: gap -> source linkage and geocode_place", async (t) => {
  t.before(async () => {
    process.env.SUPABASE_URL = "https://mock-supabase.example.com";
    process.env.SUPABASE_SERVICE_KEY = "mock-key";
    const route = await import("../app/api/mcp/route");
    POST = route.POST;
    originalFetch = globalThis.fetch;
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("list_gaps: a gap with a real 'Gap ID N' reference gets a non-empty, legible related_sources", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const result = await toolResult(await POST(rpcCall("list_gaps")));
    const gap8 = result.waypoints.find((w: any) => w.id === 8);
    assert.ok(gap8, "gap 8 present in waypoints");
    assert.equal(gap8.related_sources.length, 2, "both the decision and the intent referencing Gap ID 8 are surfaced");
    const decisionMatch = gap8.related_sources.find((m: any) => m.via === "source_policy_decisions");
    assert.ok(decisionMatch, "the approved decision is linked");
    assert.equal(decisionMatch.record_id, 18);
    assert.equal(decisionMatch.endpoint, "archive.org");
    assert.match(decisionMatch.reason, /Gap ID 8/);
    const intentMatch = gap8.related_sources.find((m: any) => m.via === "source_proposal_intents");
    assert.ok(intentMatch, "the proposal intent is linked");
    assert.equal(intentMatch.url, "https://archive.org/details/verrazanosvoyage00verr");
    assert.equal(intentMatch.endpoint, "archive.org");
  });

  await t.test("list_gaps: a gap with no 'Gap ID N' reference gets an explicit empty array, never a guess", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const result = await toolResult(await POST(rpcCall("list_gaps")));
    const gap105 = result.waypoints.find((w: any) => w.id === 105);
    assert.ok(gap105, "gap 105 present in waypoints");
    assert.deepEqual(gap105.related_sources, []);
  });

  await t.test("list_gaps: 'Gap ID 8' does not leak onto a similarly-numbered gap (word-boundary check)", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const decoyGaps = [...GAPS, { ...GAPS[1], id: 81, title: "Decoy gap 81" }];
    globalThis.fetch = ((input: unknown) => {
      const url = new URL(String(typeof input === "string" ? input : (input as any).url));
      if (url.hostname === "mock-supabase.example.com" &&
          url.pathname === "/rest/v1/editorial_gaps" &&
          url.searchParams.get("status") === "eq.open") {
        return Promise.resolve(jsonResponse(decoyGaps));
      }
      return mockBackendFetch(input);
    }) as any;
    const result = await toolResult(await POST(rpcCall("list_gaps")));
    const gap81 = result.waypoints.find((w: any) => w.id === 81);
    assert.ok(gap81);
    assert.deepEqual(gap81.related_sources, [], "'Gap ID 8' must not match gap 81");
  });

  await t.test("geocode_place: a well-known place resolves via Wikidata with declared provenance", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const result = await toolResult(await POST(rpcCall("geocode_place", { place: "Tahiti" })));
    assert.equal(result.found, true);
    assert.equal(result.latitude, -17.6797);
    assert.equal(result.longitude, -149.4068);
    assert.equal(result.coord_provenance, "gazetteer:wikidata:wikidata:Q1440");
    assert.equal(result.source_url, "https://www.wikidata.org/wiki/Q1440");
  });

  await t.test("geocode_place: falls back to Nominatim when Wikidata has no hit", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const result = await toolResult(await POST(rpcCall("geocode_place", { place: "Saint-Malo-fallback" })));
    assert.equal(result.found, true);
    assert.equal(result.coord_provenance, "gazetteer:nominatim:nominatim");
    assert.equal(result.latitude, 48.6493);
    assert.equal(result.longitude, -2.0257);
  });

  await t.test("geocode_place: an unresolvable name returns an explicit not-found, never a fabricated coordinate", async () => {
    globalThis.fetch = mockBackendFetch as any;
    const result = await toolResult(await POST(rpcCall("geocode_place", { place: "Zzqzxnotarealplace123" })));
    assert.equal(result.found, false);
    assert.equal(result.latitude, null);
    assert.equal(result.longitude, null);
    assert.equal(result.coord_provenance, null);
    assert.match(result.note, /do not invent/i);
  });
});

test("Phase 4: source-level guarantees", () => {
  // Both new tools are read-only against governance/content tables — assert
  // it structurally, since a regression here would be a real-data hazard.
  const geocodeCase = ROUTE_SRC.slice(
    ROUTE_SRC.indexOf('case "geocode_place"'),
    ROUTE_SRC.indexOf('case "submit_draft"'));
  assert.doesNotMatch(geocodeCase, /sb\(\s*"(POST|PATCH|DELETE)"/,
    "geocode_place must never write");

  const linkageStart = ROUTE_SRC.indexOf("async function resolveSourceSubject");
  const linkageEnd = ROUTE_SRC.indexOf("const keyHash =");
  assert.ok(linkageStart > -1 && linkageEnd > linkageStart);
  const linkageSrc = ROUTE_SRC.slice(linkageStart, linkageEnd);
  assert.doesNotMatch(linkageSrc, /sb\(\s*"(POST|PATCH|DELETE)"/,
    "gap-linkage resolution must never write");

  // The mechanical convention, not a semantic/fuzzy substitute — this is the
  // one regex the whole feature stands on, so pin its literal shape rather
  // than re-deriving it (avoids an escaping mismatch between two regexes).
  assert.ok(
    ROUTE_SRC.includes("gap[\\\\s_-]*(?:id)?[\\\\s_-]*#?[\\\\s_-]*0*${gapId}\\\\b"),
    "gapRefPattern's word-bounded regex shape changed unexpectedly",
  );

  // ingest/oculus.py stays the operator-side path — untouched by this phase.
  const oculus = readFileSync(join(__dirname, "../ingest/oculus.py"), "utf8");
  assert.match(oculus, /def geocode\(place: str\):/);
});

test("Phase 4: tool catalogue declares geocode_place and its place in the sequence", () => {
  assert.match(ROUTE_SRC, /name:\s*"geocode_place"/);
  const toolStart = ROUTE_SRC.indexOf('{ name: "geocode_place"');
  const toolEnd = ROUTE_SRC.indexOf('{ name: "submit_draft"');
  const toolSrc = ROUTE_SRC.slice(toolStart, toolEnd);
  assert.match(toolSrc, /required["\s:]+\["place"\]/);
  assert.match(toolSrc, /submit_draft/, "description should say where it fits before submit_draft");
});
