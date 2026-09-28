import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";
import {
  effectiveEndpoints, resolveTrust, SEED_ENDPOINTS,
  type RegistryRow, type RightsClass, type SourceEndpoint,
} from "@/lib/source-governance";

/**
 * The agent-facing discovery + fetch path — Phase 3 of the contribution
 * pipeline roadmap.
 *
 * Until this module existed, an agent that wanted to write a draft had no way
 * to search *inside* the sources Terraveler already trusts: that capability
 * lived only in Python (`ingest/oculus.py`, `ingest/source_registry.py`,
 * `ingest/fetch.py`), reachable by the operator's ingestion container, never
 * by an external agent talking to `app/api/mcp/route.ts` on Vercel. This is
 * a NEW, PARALLEL, read-only path for agents — it does not replace or alter
 * the Python bulk/operator pipeline, and it writes to nothing.
 *
 * Two security boundaries are ported here, deliberately kept distinct
 * because their Python originals are distinct:
 *
 *   - `searchSources()` mirrors `ingest/source_registry.py` + the two
 *     adapter functions it registers (`gutendex`, `mediawiki_search`) and
 *     `ingest/oculus.py::discover()`'s pooling/cap logic. Its adapter
 *     ROSTER (which searches run at all) is read live from
 *     `source_search_adapters` — the same DB table, same join to
 *     `source_endpoints.status = 'active'`, same query Python runs — so a
 *     retired or quarantined endpoint drops out of discovery here exactly
 *     as it does there, with no redeploy needed.
 *
 *   - Every URL either function is about to request is *additionally*
 *     checked against `isAllowedHost()`/`isGovernedHost()` below — the
 *     fetch-side trust boundary, kept distinct from the adapter roster.
 *
 *     That boundary used to be a static copy of the nine hosts
 *     `ingest/whitelist.py` hardcodes, on the stated ground that a database
 *     row could narrow what is searched but never widen what may be
 *     fetched. The consequence was an approval with no effect: an editor
 *     could approve a source (PARES, DBNL, ...) and nothing that enforces
 *     trust would ever notice. It is now the seed floor PLUS whatever the
 *     live registry holds as an effective approval — see
 *     `lib/source-governance.ts::effectiveEndpoints`, which also keeps
 *     revocation working (a seed host quarantined in the registry drops
 *     out) and refuses to act on an approval whose rights are unknown.
 *     The registry can only widen trust through an approval a human made;
 *     an empty or unreachable database can never leave this narrower than
 *     the seeds it always enforced.
 *
 *     `lib/gate.ts`'s `DOMAINS`/`domainOk()` is a DIFFERENT, deliberately
 *     BROADER list (~40 institutional domains, comment: "what a machine
 *     may ingest unattended... is answered by ingest/whitelist.py, which
 *     is a different list for a reason") for citing evidence a human or
 *     the Curator can still go verify — not a green light for an
 *     unattended agent to pull raw text from. Using it here would let this
 *     tool auto-fetch text from institutions no editor has approved. It was
 *     considered and rejected for exactly that reason.
 */

// ------------------------------------------------------------------ HTTP
const UA = "Terraveler-AgentSourceSearch/1.0 (contact: dbaldoni@gmail.com)";
const HTTP_TIMEOUT_MS = 20_000;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`request to ${new URL(url).host} failed: HTTP ${r.status}`);
  return r.json();
}

const MAX_REDIRECTS = 5;

function isArchiveFamily(host: string): boolean {
  return host === "archive.org" || host.endsWith(".archive.org");
}

/**
 * Whether a redirect stays inside what is governed. The gate is checked
 * against the URL an agent ASKED for; fetch follows redirects, so it must be
 * re-established against the URL that answered — or a governed host that
 * redirects (gutenberg.org → www.gutenberg.org, or an open redirect) binds
 * the trust decision to a body some other host chose, and quarantining one
 * host of a pair would not stop the other one serving it.
 *
 * Mirrors scripts/desk_graph.py::redirect_stays_home: archive.org hands item
 * files to per-item CDN nodes (dn760108.eu.archive.org, ia800808.us.archive.org)
 * that are its own infrastructure and not separately registered.
 */
export function redirectStaysGoverned(asked: string, answered: string): boolean {
  let from: URL, to: URL;
  try {
    from = new URL(asked);
    to = new URL(answered);
  } catch {
    return false;
  }
  if (to.protocol !== "https:" || to.username || to.password) return false;
  if (isGovernedHost(answered)) return true;
  return isArchiveFamily(from.hostname.toLowerCase()) && isArchiveFamily(to.hostname.toLowerCase());
}

/**
 * GET a governed source's text, following redirects by hand so every hop is
 * re-checked. `fetchImpl` is a seam for tests.
 */
export async function getGovernedText(startUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await fetchImpl(url, {
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location");
      if (!location) throw new Error(`request to ${new URL(url).host} failed: HTTP ${r.status} with no Location`);
      const next = new URL(location, url).toString();
      if (!redirectStaysGoverned(url, next))
        throw new Error(
          `fetch_source_text: ${new URL(url).host} redirected to ${new URL(next).host}, which is not a governed source — refusing to follow.`,
        );
      url = next;
      continue;
    }
    if (!r.ok) throw new Error(`request to ${new URL(url).host} failed: HTTP ${r.status}`);
    return r.text();
  }
  throw new Error("fetch_source_text: too many redirects");
}

// ------------------------------------------------------------------ whitelist gates
/**
 * True only for hosts whose licence is guaranteed WHOLESALE — mirrors
 * `whitelist.is_allowed()` exactly (which is what `source_registry.py`'s
 * adapters call before any HTTP request). archive.org is deliberately
 * excluded: it is `item_verified`, not `domain_trusted`, in the very seed
 * data this reuses, matching Python's own docstring ("archive.org is
 * deliberately excluded here: it needs verify_source()").
 */
export function isAllowedHost(url: string): boolean {
  return resolveTrust(url, currentEndpoints())?.endpoint.trust_mode === "domain_trusted";
}

/**
 * True for any host governed by an ACTIVE endpoint of any trust mode —
 * mirrors the broader `_verify_source_legacy()` shape (guaranteed-wholesale
 * OR a `VERIFIED_DOMAINS` item-verification host). Used by `fetchSourceText`
 * because it must also serve `kind="archive"`, which `isAllowedHost` (by
 * design, matching Python) always refuses. This does NOT perform the
 * archive.org per-item metadata check itself — that stays the Curator's job
 * at review time (`scripts/desk_review.py`), exactly as the task requires;
 * it only confirms the HOST is one Terraveler governs at all.
 */
export function isGovernedHost(url: string): boolean {
  return resolveTrust(url, currentEndpoints()) !== null;
}

// ------------------------------------------------------------------ the live registry
const REGISTRY_TTL_MS = 60_000;
// A registry that keeps failing to reload is no longer trusted to describe
// revocations either, so past this the view is dropped — see currentEndpoints
// for what a dropped view means.
const REGISTRY_MAX_STALE_MS = 10 * 60_000;
// Bounded well inside a request's budget: this read is in front of every fetch.
const REGISTRY_LOAD_TIMEOUT_MS = 2_500;

let registry: { endpoints: SourceEndpoint[]; loadedAt: number } | null = null;
let registryLoad: Promise<void> | null = null;
// Whether a registry is expected at all. Where no backend is configured (a
// local checkout, the unit tests) the seed hosts are the only authority there
// is; where one IS configured, "could not read it" must not be read as "no
// revocations".
let registryRequired = Boolean(POSTGREST_URL);

/**
 * The endpoints in force right now. A loaded view (fresh, or stale within
 * REGISTRY_MAX_STALE_MS) is used as it stands. With no view:
 *  - a backend is configured → NOTHING is governed. This fails CLOSED, like
 *    the Python registry authority does: falling back to the seeds would
 *    re-trust a host the editor had quarantined, exactly when the registry
 *    that says so cannot be read;
 *  - no backend configured → the seed floor.
 */
function currentEndpoints(): readonly SourceEndpoint[] {
  if (registry) return registry.endpoints;
  return registryRequired ? [] : SEED_ENDPOINTS;
}

/** True when a backend is configured but no usable view of it exists. */
export function registryUnavailable(): boolean {
  return registryRequired && registry === null;
}

/**
 * Read the registry rows: every endpoint (any status, so a revoked seed is
 * visible as revoked) joined to the rights class on its newest decision.
 * Pure of caching and fallbacks, so it can be tested with a fake backend.
 */
export async function loadRegistryRows(
  fetchJson: (path: string) => Promise<any> = pg,
): Promise<RegistryRow[]> {
  const endpoints: any[] = await fetchJson(
    "source_endpoints?select=id,institution_id,host_pattern,match_type,status,trust_mode&order=id.asc&limit=1000");
  // nullslast: Postgres sorts NULL first on DESC, which would make a row with
  // no timestamp read as the newest decision.
  const decisions: any[] = await fetchJson(
    "source_policy_decisions?endpoint_id=not.is.null&select=endpoint_id,decision_outcome,rights_class" +
    "&order=timestamp.desc.nullslast,id.desc&limit=5000");
  if (!Array.isArray(endpoints) || !Array.isArray(decisions))
    throw new Error("source registry backend returned an error object instead of rows");

  const newest = new Map<number, { outcome: string; rights: RightsClass }>();
  for (const d of decisions) {
    const id = Number(d.endpoint_id);
    if (!newest.has(id)) newest.set(id, { outcome: String(d.decision_outcome), rights: d.rights_class });
  }
  return endpoints.map((e: any) => {
    const latest = newest.get(Number(e.id));
    return {
      id: Number(e.id),
      institution_id: e.institution_id == null ? null : Number(e.institution_id),
      host_pattern: String(e.host_pattern),
      match_type: e.match_type,
      status: e.status,
      trust_mode: e.trust_mode ?? null,
      // Only an approval carries rights the registry may act on: an
      // endpoint whose newest decision is anything else has none.
      rights_class: latest && latest.outcome === "approve" ? latest.rights : null,
    };
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`source registry read exceeded ${ms}ms`)), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Refresh the registry view if it is older than the TTL. Never throws, never
 * waits longer than REGISTRY_LOAD_TIMEOUT_MS, and concurrent callers share one
 * read rather than each starting their own. A failed read keeps the last good
 * view until it is REGISTRY_MAX_STALE_MS old; after that there is no view and
 * currentEndpoints() decides what that means. Called at the top of each async
 * entry point so the synchronous host gates read a current view.
 */
export function ensureRegistry(
  now: number = Date.now(),
  fetchJson: (path: string) => Promise<any> = pg,
  timeoutMs: number = REGISTRY_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (registry && now - registry.loadedAt < REGISTRY_TTL_MS) return Promise.resolve();
  // No backend expected and none injected: nothing to read, the seeds are the
  // whole authority — do not go to the network to find that out.
  if (!registryRequired && fetchJson === pg) return Promise.resolve();
  if (registryLoad) return registryLoad;
  registryLoad = (async () => {
    try {
      const rows = await withTimeout(loadRegistryRows(fetchJson), timeoutMs);
      registry = { endpoints: effectiveEndpoints(rows), loadedAt: now };
    } catch {
      if (registry && now - registry.loadedAt >= REGISTRY_MAX_STALE_MS) registry = null;
    } finally {
      registryLoad = null;
    }
  })();
  return registryLoad;
}

/** Test seam: drop any cached view so the next ensureRegistry() reloads. */
export function resetRegistryCache(): void {
  registry = null;
  registryLoad = null;
}

/** Test seam: pretend a backend is (not) configured. */
export function setRegistryRequiredForTest(required: boolean): void {
  registryRequired = required;
}

// ------------------------------------------------------------------ source_search_adapters registry
export interface AdapterRow {
  id: number;
  adapter: string;
  config: Record<string, any>;
  capability: string;
  priority: number;
  max_candidates: number;
  endpoint_id: number | null;
  institution_id: number | null;
  notes: string | null;
}

// A backend that accepts the connection and never answers must cost a bounded
// wait, not the whole request: the registry read now sits in front of every
// fetch and search, which never touched the database before.
const PG_TIMEOUT_MS = 8_000;

async function pg(path: string): Promise<any> {
  if (!POSTGREST_URL) throw new Error("source registry unavailable: POSTGREST_URL is not configured");
  const r = await fetch(`${POSTGREST_URL}/rest/v1/${path}`, {
    headers: {
      apikey: POSTGREST_SERVICE_KEY,
      Authorization: `Bearer ${POSTGREST_SERVICE_KEY}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PG_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`source registry backend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/**
 * Pure join: enabled adapter rows whose `endpoint_id` names an active
 * endpoint, OR whose `institution_id` owns at least one active endpoint —
 * the exact condition `load_adapters()`'s SQL `exists (...)` expresses,
 * done here in JS because PostgREST has no `exists` filter operator.
 * Separated from `loadActiveAdapters()`'s network I/O so the join itself is
 * directly unit-testable without a DB or an HTTP mock.
 */
export function filterActiveAdapters(
  activeEndpoints: Array<{ id: number | string; institution_id: number | string | null }>,
  rawAdapters: any[],
): AdapterRow[] {
  const activeEndpointIds = new Set<number>(activeEndpoints.map((e) => Number(e.id)));
  const activeInstitutionIds = new Set<number>(
    activeEndpoints.map((e) => e.institution_id).filter((x) => x != null).map(Number),
  );
  return rawAdapters
    .filter(
      (a) =>
        (a.endpoint_id != null && activeEndpointIds.has(Number(a.endpoint_id))) ||
        (a.institution_id != null && activeInstitutionIds.has(Number(a.institution_id))),
    )
    .map((a) => ({
      id: Number(a.id),
      adapter: String(a.adapter),
      config: a.config ?? {},
      capability: String(a.capability),
      priority: Number(a.priority),
      max_candidates: Number(a.max_candidates),
      endpoint_id: a.endpoint_id == null ? null : Number(a.endpoint_id),
      institution_id: a.institution_id == null ? null : Number(a.institution_id),
      notes: a.notes ?? null,
    }));
}

/**
 * Enabled adapters covering at least one ACTIVE endpoint, ordered by
 * priority ascending — the exact same shape and the exact same join
 * `ingest/source_registry.py::load_adapters()` runs, expressed as two
 * PostgREST selects instead of one SQL `exists (...)` plus `filterActiveAdapters()`
 * above. Same two tables, same two columns, same two conditions.
 */
export async function loadActiveAdapters(): Promise<AdapterRow[]> {
  const [endpoints, adapters] = await Promise.all([
    pg("source_endpoints?status=eq.active&select=id,institution_id"),
    pg(
      "source_search_adapters?enabled=eq.true" +
        "&select=id,adapter,config,capability,priority,max_candidates,endpoint_id,institution_id,notes" +
        "&order=priority.asc,id.asc",
    ),
  ]);
  return filterActiveAdapters(endpoints ?? [], adapters ?? []);
}

// ------------------------------------------------------------------ candidate shape
export interface Candidate {
  kind: string;
  title: string;
  url: string;
  source_url: string;
  license: string;
  lang: string;
  hint: string;
  /** Which adapter row found this candidate — provenance, not decoration:
   *  a caller citing this candidate should know where it came from without
   *  guessing from the URL shape. */
  adapter: string;
}

/** Raised by an adapter when its OWN config would produce an off-whitelist
 *  request — mirrors `source_registry.py::AdapterRejected`. Never raised for
 *  "found nothing" (that is an empty list); always turned into a named
 *  entry in `adapters_failed`, never into a request that happens anyway. */
export class AdapterRejected extends Error {}

const LANG_RE = /^[a-z]{2,3}(-[a-z]+)?$/;

/**
 * KNOWN PRODUCTION FAILURE MODE (investigated 2026-09-25, live collaudo):
 * this adapter can — and, as of this writing, reliably does — fail with
 * HTTP 403 when called from this route's live Vercel deployment, while the
 * IDENTICAL request (same URL, same query, same `UA` string format, no
 * extra headers Python sends that this doesn't) succeeds every time from
 * `ingest/source_registry.py::gutendex()` running on the VPS, and from a
 * plain `curl` off the VPS with the same custom User-Agent. This was
 * confirmed NOT to be a header/logic mismatch: `getJson()` above sends
 * `User-Agent` + `Accept: application/json`, `ingest/fetch.py::_get()` sends
 * only `User-Agent` (via stdlib `urllib`, which follows redirects the same
 * way `fetch()` does) — neither includes anything the other lacks that
 * would explain a 403. gutendex.com's own response headers show
 * `server: cloudflare`; Cloudflare's bot/IP-reputation heuristics are known
 * to challenge or block shared cloud/serverless egress ranges (this
 * includes Vercel's function IP pool) far more readily than a single,
 * long-lived VPS host, REGARDLESS of a legitimate, identifying User-Agent —
 * there is no request header this module can add that fixes an IP-based
 * block from the inside. If this starts failing from the VPS/tests too,
 * look elsewhere first; if it is ONLY the live MCP route, this is almost
 * certainly the same known asymmetry, not a new regression. The adapter
 * failing here must never fail the whole `search_sources` call — see the
 * try/catch in `searchSources()` below, which already pools whatever the
 * other adapters (e.g. `mediawiki_search`) found.
 */
export async function gutendexSearch(subject: string, lang: string, maxCandidates: number): Promise<Candidate[]> {
  const q = new URLSearchParams({ search: subject });
  let data: any;
  try {
    data = await getJson(`https://gutendex.com/books/?${q.toString()}`);
  } catch (exc: any) {
    const msg = String(exc?.message ?? exc);
    if (/HTTP 403/.test(msg)) {
      throw new Error(`${msg} (likely Cloudflare blocking Vercel's IP pool, not a code bug — see comment above gutendexSearch)`);
    }
    throw exc;
  }
  const out: Candidate[] = [];
  for (const b of data?.results ?? []) {
    const fmts: Record<string, string> = b.formats ?? {};
    let txt: string | null = null;
    for (const [k, v] of Object.entries(fmts)) {
      if (k.startsWith("text/plain") && typeof v === "string" && !v.endsWith(".zip")) {
        txt = v;
        break;
      }
    }
    if (!txt || !isAllowedHost(txt)) continue;
    const title = b.title ?? "";
    const authors = (b.authors ?? []).map((a: any) => a.name ?? "").join(", ");
    const fullTitle = `${title} — ${authors}`.replace(/^[\s—]+|[\s—]+$/g, "");
    out.push({
      kind: "gutenberg", lang, title: fullTitle,
      hint: `Public-domain book: ${fullTitle}`,
      url: txt,
      source_url: `https://www.gutenberg.org/ebooks/${b.id}`,
      license: "Public domain",
      adapter: "gutendex",
    });
    if (out.length >= maxCandidates) break;
  }
  return out;
}

function mediawikiHost(config: Record<string, any>, lang: string): string {
  const template = config.api_base_template || "";
  if (!template) throw new AdapterRejected("mediawiki_search: config has no api_base_template");
  const apiUrl = template.replace("{lang}", lang);
  let host: string;
  try {
    host = new URL(apiUrl).host;
  } catch {
    throw new AdapterRejected(`mediawiki_search: unparseable api_base_template ${JSON.stringify(template)}`);
  }
  if (!host) throw new AdapterRejected(`mediawiki_search: unparseable api_base_template ${JSON.stringify(template)}`);
  if (!isAllowedHost(apiUrl))
    throw new AdapterRejected(
      `mediawiki_search: host ${JSON.stringify(host)} (from api_base_template) is off-whitelist — refusing before any request`,
    );
  return apiUrl;
}

export async function mediawikiSearch(
  subject: string, lang: string, config: Record<string, any>, maxCandidates: number,
): Promise<Candidate[]> {
  if (!LANG_RE.test(lang || ""))
    throw new AdapterRejected(
      `mediawiki_search: lang ${JSON.stringify(lang)} does not match ${LANG_RE.source} — refusing to build a host/path from it`,
    );
  const kind = config.kind || "mediawiki";
  const license = config.license || "unknown";
  const apiBase = mediawikiHost(config, lang);
  const host = new URL(apiBase).host;

  const q = new URLSearchParams({
    action: "query", list: "search", srsearch: subject,
    srlimit: String(maxCandidates), format: "json",
  });
  const data = await getJson(`${apiBase}?${q.toString()}`);
  const results = data?.query?.search ?? [];
  const out: Candidate[] = [];
  for (const t of results) {
    const snippet = String(t.snippet ?? "").replace(/<[^>]+>/g, "");
    const title = t.title;
    const pageUrl = `https://${host}/wiki/${title.replace(/ /g, "_")}`;
    out.push({
      kind, lang, title, hint: snippet, license,
      url: pageUrl, source_url: pageUrl, adapter: "mediawiki_search",
    });
    if (out.length >= maxCandidates) break;
  }
  return out;
}

// Legacy soft caps kept for parity with `oculus.discover(max_books=3,
// max_articles=8)`'s defaults — every real caller (scout.py, the
// pipeline_native `discover` node) uses those defaults, so an agent calling
// this tool with the current DB row values (gutendex max_candidates=3,
// wikipedia max_candidates=8) sees identical effective limits.
const DEFAULT_MAX_BOOKS = 3;
const DEFAULT_MAX_ARTICLES = 8;

// Same total, verified against `ingest/oculus.py::DEFAULT_CANDIDATE_CAP`.
export const DEFAULT_CANDIDATE_CAP = 24;

export interface SearchSourcesResult {
  candidates: Candidate[];
  adapters_used: Array<{ adapter: string; priority: number; max_candidates: number }>;
  adapters_unimplemented: string[];
  adapters_failed: Array<{ adapter: string; why: string }>;
  dropped_by_cap: Record<string, number>;
}

// Exported (mutable, like Python's `SR.ADAPTERS` dict) so a test can inject
// a fake adapter — e.g. to pin the cap/pooling behaviour without a live
// network call — and remove it again afterwards.
export const ADAPTER_FNS: Record<
  string,
  (subject: string, lang: string, config: Record<string, any>, maxCandidates: number) => Promise<Candidate[]>
> = {
  gutendex: (subject, lang, _config, max) => gutendexSearch(subject, lang, max),
  mediawiki_search: (subject, lang, config, max) => mediawikiSearch(subject, lang, config, max),
};

/**
 * Search every enabled, active search adapter for `subject` and pool the
 * results — mirrors `ingest/oculus.py::discover()`'s merge/sort/cap logic
 * exactly (pool tagged with adapter priority, sort by priority, slice to
 * `totalCap`, and report what got dropped by adapter name).
 *
 * `adapters`: an already-loaded roster, mirroring `discover(registry=...)`
 * in Python — left `undefined`, `loadActiveAdapters()` is called here
 * instead. Exists so a test (or a caller batching several subjects) can
 * supply a fixed roster without a live DB round-trip per call.
 */
export async function searchSources(
  subject: string, lang = "en", totalCap: number = DEFAULT_CANDIDATE_CAP,
  adapters?: AdapterRow[],
): Promise<SearchSourcesResult> {
  await ensureRegistry();
  if (registryUnavailable())
    throw new Error(
      "search_sources: the source registry cannot be read right now, so no host can be confirmed as governed — refusing to search (fail closed). Retry shortly.",
    );
  const loaded = adapters ?? (await loadActiveAdapters());
  const searchAdapters = loaded
    .filter((a) => a.capability === "search")
    .sort((a, b) => a.priority - b.priority || a.id - b.id);

  const adaptersUsed: SearchSourcesResult["adapters_used"] = [];
  const unimplemented = new Set<string>();
  const failed: SearchSourcesResult["adapters_failed"] = [];
  const pooled: Array<{ priority: number; candidate: Candidate }> = [];

  for (const a of searchAdapters) {
    adaptersUsed.push({ adapter: a.adapter, priority: a.priority, max_candidates: a.max_candidates });
    const fn = ADAPTER_FNS[a.adapter];
    if (!fn) {
      unimplemented.add(a.adapter);
      continue;
    }
    let effectiveMax = a.max_candidates;
    if (a.adapter === "gutendex") effectiveMax = Math.min(effectiveMax, DEFAULT_MAX_BOOKS);
    else if (a.adapter === "mediawiki_search" && a.config?.kind === "wikipedia")
      effectiveMax = Math.min(effectiveMax, DEFAULT_MAX_ARTICLES);

    try {
      const found = (await fn(subject, lang, a.config, effectiveMax)) ?? [];
      for (const c of found.slice(0, effectiveMax)) pooled.push({ priority: a.priority, candidate: c });
    } catch (exc: any) {
      failed.push({ adapter: a.adapter, why: `${exc?.constructor?.name ?? "Error"}: ${String(exc?.message ?? exc).slice(0, 160)}` });
    }
  }

  // Stable sort by priority only (ties keep pool insertion order, itself
  // already priority/id-ordered from `searchAdapters` above) — matches
  // Python's `pooled.sort(key=lambda t: t[0])`, which is also a stable sort.
  const stable = pooled.map((p, i) => ({ ...p, i })).sort((x, y) => x.priority - y.priority || x.i - y.i);
  const kept = stable.slice(0, totalCap);
  const dropped = stable.slice(totalCap);

  const droppedByCap: Record<string, number> = {};
  for (const d of dropped) droppedByCap[d.candidate.adapter] = (droppedByCap[d.candidate.adapter] ?? 0) + 1;

  return {
    candidates: kept.map((k) => k.candidate),
    adapters_used: adaptersUsed,
    adapters_unimplemented: [...unimplemented].sort(),
    adapters_failed: failed,
    dropped_by_cap: droppedByCap,
  };
}

// ------------------------------------------------------------------ fetch_source_text
// Ported from `ingest/fetch.py::fetch_by_kind()` and friends, INCLUDING the
// Wikisource transclusion fix from branch `fix/wikisource-transclusion-extraction`
// (commit 4bfebaf, not yet merged to main at the time this was written): a
// Wikisource "work" page is composed via `<pages index=... />` transclusion
// that `prop=extracts` never resolves (it silently returns an empty or
// header-only extract, no error) — so Wikisource hosts go through
// `action=parse&prop=text` instead, and the rendered HTML is reduced to text
// by `wikisourceRenderToText()` below, byte-for-byte the same order of
// operations as the Python fix.

const START_MARKER_RE = /\*\*\* START OF[\s\S]*?\*\*\*/;
const END_MARKER_RE = /\*\*\* END OF/;

/** `ingest/fetch.py::fetch_gutenberg()` — both offsets are computed against
 *  the ORIGINAL text and the tail is cut before the head, or exactly
 *  `a.end()` characters of Project Gutenberg licence boilerplate ride into
 *  the corpus labelled as the traveller's own words (the bug this order
 *  fixes, per the Python comment). */
function stripGutenbergBoilerplate(raw: string): string {
  const a = START_MARKER_RE.exec(raw);
  const b = END_MARKER_RE.exec(raw);
  let txt = raw;
  if (b) txt = txt.slice(0, b.index);
  if (a) txt = txt.slice(a.index + a[0].length);
  return txt.trim();
}

const WS_STYLE_SCRIPT_RE = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const WS_BR_RE = /<br\s*\/?>/gi;
const WS_BLOCK_CLOSE_RE = /<\/(p|div|li|h[1-6]|tr|table)\s*>/gi;
const WS_TAG_RE = /<[^>]+>/g;
// The character between the slashes below is invisible on purpose: it IS
// U+200B (zero-width space), the exact character this regex exists to
// match — mirroring `ingest/fetch.py`'s own `text.replace("​", "")`, which
// uses the same literal character rather than an escape. Do not "clean up"
// this line by retyping it; a whitespace-trimming edit can silently delete
// the character this regex depends on.
const ZERO_WIDTH_SPACE_RE = /​/g;

// A deliberately generic decoder, not the full HTML5 named-entity table:
// MediaWiki's rendered output realistically only ever emits the five XML
// entities, &nbsp;, numeric references, and a small set of Latin-1/typographic
// names. Verified empirically against a real Wikisource page (see
// test/source-search.test.ts and the manual verification in the Phase 3
// handoff) to leave no literal "&...;" residue.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  shy: "­", deg: "°", times: "×", divide: "÷",
  plusmn: "±", sect: "§", para: "¶", dagger: "†",
  Dagger: "‡", bull: "•", copy: "©", reg: "®",
  trade: "™", middot: "·", laquo: "«", raquo: "»",
  euro: "€", pound: "£", cent: "¢", yen: "¥",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã",
  auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô",
  otilde: "õ", ouml: "ö", oslash: "ø", ugrave: "ù",
  uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã",
  Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô",
  Otilde: "Õ", Ouml: "Ö", Oslash: "Ø", Ugrave: "Ù",
  Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
  szlig: "ß", oelig: "œ", OElig: "Œ",
};
const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

function unescapeHtml(text: string): string {
  return text.replace(ENTITY_RE, (m, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

/**
 * `ingest/fetch.py::_wikisource_render_to_text()` — order matters, see the
 * Python docstring: style/script stripped WHOLESALE first (a naive tag-strip
 * alone leaves their CSS/JS behind as literal text), block-close tags become
 * paragraph breaks BEFORE the remaining markup is stripped, zero-width
 * spaces (MediaWiki's invisible page-boundary markers) are dropped outright.
 */
export function wikisourceRenderToText(rawHtml: string): string {
  let text = rawHtml.replace(WS_STYLE_SCRIPT_RE, "");
  text = text.replace(WS_BR_RE, "\n");
  text = text.replace(WS_BLOCK_CLOSE_RE, "\n\n");
  text = text.replace(WS_TAG_RE, "");
  text = unescapeHtml(text);
  text = text.replace(ZERO_WIDTH_SPACE_RE, "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]*(\n[ \t]*)+/g, "\n\n");
  return text.trim();
}

/** `ingest/fetch.py::fetch_mediawiki_extract()` — Wikisource goes through
 *  `action=parse&prop=text` + `wikisourceRenderToText`; everything else
 *  (Wikipedia) keeps the plain `prop=extracts` call. */
async function fetchMediawikiExtract(host: string, title: string): Promise<string> {
  if (host.endsWith(".wikisource.org")) {
    const q = new URLSearchParams({ action: "parse", prop: "text", page: title, redirects: "1", format: "json" });
    const data = await getJson(`https://${host}/w/api.php?${q.toString()}`);
    const rawHtml = data?.parse?.text?.["*"] ?? "";
    return wikisourceRenderToText(rawHtml);
  }
  const q = new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", titles: title, redirects: "1", format: "json" });
  const data = await getJson(`https://${host}/w/api.php?${q.toString()}`);
  const pages = data?.query?.pages ?? {};
  return Object.values(pages).map((p: any) => p?.extract ?? "").join(" ").trim();
}

/** `ingest/fetch.py::fetch_archive_text()` — an archive.org OCR text, no
 *  markers to strip. Licence is NOT established here; per-item PD
 *  verification (`whitelist.verify_archive_item`) stays the Curator's job at
 *  review time — this tool only fetches the text to read. */
async function fetchArchiveText(url: string): Promise<string> {
  return (await getGovernedText(url)).trim();
}

/** Title recovered from a candidate's own `url`, inverting exactly how
 *  `mediawikiSearch` built it (`https://{host}/wiki/{title.replace(" ","_")}`)
 *  — the MCP tool signature is `(url, kind, lang?)`, with no separate title
 *  parameter, so the URL a `search_sources` candidate already carries is the
 *  only place the title can come from. */
function titleFromWikiUrl(url: URL): string {
  const marker = "/wiki/";
  const i = url.pathname.indexOf(marker);
  if (i === -1) throw new Error(`fetch_source_text: url is not a MediaWiki /wiki/ page: ${url.pathname}`);
  const encoded = url.pathname.slice(i + marker.length);
  return decodeURIComponent(encoded).replace(/_/g, " ");
}

export interface FetchedText {
  text: string;
  truncated: boolean;
  total_length: number;
}

// Chosen so a genuine excerpt (a chapter, a log entry, an OCR page range) is
// still large enough to quote from, while staying well inside what a single
// tool response should hand an agent's context in one go — the same "cap,
// and SAY you capped" shape as `MAX_DRAFT_BYTES`/`TEXT_LIMITS` in
// lib/gate.ts, sized for reading rather than for a submission payload.
export const MAX_FETCHED_TEXT_CHARS = 60_000;

/**
 * Fetch the full text of ONE candidate (from `search_sources`, or any URL an
 * agent already knows is on-source) by `kind` — mirrors
 * `ingest/fetch.py::fetch_by_kind()`'s dispatch exactly, including its
 * refusal to fall back to a different fetcher for an unrecognized `kind`
 * (that silent-fallback-to-Wikipedia bug is the whole reason `fetch_by_kind`
 * exists in Python; the same fix is preserved here, not re-broken in the
 * port).
 */
export async function fetchSourceText(rawUrl: string, kind: string, lang?: string): Promise<FetchedText> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("fetch_source_text: url is not a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("fetch_source_text: url must be a plain http(s) URL with no embedded credentials.");

  // The security gate — BEFORE any request, exactly the discipline
  // `source_registry.py`'s own docstring demands of the Python adapters.
  await ensureRegistry();
  if (registryUnavailable())
    throw new Error(
      "fetch_source_text: the source registry cannot be read right now, so no host can be confirmed as governed — refusing to fetch (fail closed). Retry shortly.",
    );
  if (!isGovernedHost(rawUrl))
    throw new Error(
      `fetch_source_text: ${JSON.stringify(url.host)} is not an active Terraveler source endpoint — refusing to fetch.`,
    );

  const host = url.hostname.toLowerCase();
  let text: string;
  switch (kind) {
    case "gutenberg":
      // A kind names a FETCHER, and a fetcher only knows its own site's
      // shape. With more than nine governed hosts, "any governed host" is no
      // longer a sufficient reason to run the Gutenberg one.
      if (host !== "gutenberg.org" && !host.endsWith(".gutenberg.org"))
        throw new Error(`fetch_source_text: kind="gutenberg" but ${JSON.stringify(host)} is not a gutenberg.org host.`);
      text = stripGutenbergBoilerplate(await getGovernedText(rawUrl));
      break;
    case "wikipedia": {
      if (!host.endsWith(".wikipedia.org"))
        throw new Error(`fetch_source_text: kind="wikipedia" but ${JSON.stringify(host)} is not a wikipedia.org host.`);
      if (lang && !host.startsWith(`${lang.toLowerCase()}.`))
        throw new Error(`fetch_source_text: lang=${JSON.stringify(lang)} does not match host ${JSON.stringify(host)}.`);
      text = await fetchMediawikiExtract(host, titleFromWikiUrl(url));
      break;
    }
    case "wikisource": {
      if (!host.endsWith(".wikisource.org"))
        throw new Error(`fetch_source_text: kind="wikisource" but ${JSON.stringify(host)} is not a wikisource.org host.`);
      if (lang && !host.startsWith(`${lang.toLowerCase()}.`))
        throw new Error(`fetch_source_text: lang=${JSON.stringify(lang)} does not match host ${JSON.stringify(host)}.`);
      text = await fetchMediawikiExtract(host, titleFromWikiUrl(url));
      break;
    }
    case "archive":
      if (host !== "archive.org" && host !== "www.archive.org")
        throw new Error(`fetch_source_text: kind="archive" but ${JSON.stringify(host)} is not an archive.org host.`);
      text = await fetchArchiveText(rawUrl);
      break;
    default:
      throw new Error(`fetch_source_text: no fetcher registered for kind=${JSON.stringify(kind)} (known kinds: gutenberg, wikipedia, wikisource, archive).`);
  }

  const totalLength = text.length;
  if (totalLength > MAX_FETCHED_TEXT_CHARS)
    return { text: text.slice(0, MAX_FETCHED_TEXT_CHARS), truncated: true, total_length: totalLength };
  return { text, truncated: false, total_length: totalLength };
}
