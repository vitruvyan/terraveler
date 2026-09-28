export type MatchType = "exact" | "suffix";
export type LifecycleStatus = "discovered" | "proposed" | "triaging" | "assessing" | "policy_check" | "active" | "needs_human_review" | "quarantined" | "rejected" | "retired";
export type TrustMode = "domain_trusted" | "collection_trusted" | "item_verified" | "link_only";
export type RightsScopeType = "endpoint" | "collection" | "item";
export type RightsClass = "public_domain" | "creative_commons" | "mixed" | "in_copyright" | "unknown";
export type VerificationStrategy = "none" | "archive_org_metadata" | "wikimedia_api";

export interface EvidenceSnapshot {
  rights_scope_type: RightsScopeType;
  rights_scope_identifier?: string;
  rights_class: RightsClass;
  rights_identifier?: string;
  rights_uri?: string;
  rights_statement_url?: string;
  rights_statement_hash: string;
}

export interface SourceInstitution {
  id: number;
  slug: string;
  name: string;
  country?: string;
  primary_languages: string[];
}

export interface SourceEndpoint {
  id: number;
  institution_id: number;
  host_pattern: string;
  match_type: MatchType;
  status: LifecycleStatus;
  trust_mode: TrustMode | null; // Nullable for records without active trust decisions
}

export interface SourceCollection {
  id: number;
  endpoint_id: number;
  name: string;
  path_prefix?: string;
  status: LifecycleStatus;
  trust_mode: TrustMode | null; // Nullable
}

export interface SourceAccessRule {
  id: number;
  endpoint_id?: number;
  collection_id?: number;
  allowed_hosts: string[];
  path_patterns: string[];
  collection_identifiers: string[];
  api_endpoints: string[];
  verification_strategy: VerificationStrategy;
  expected_redirect_hosts: string[];
}

export interface SourceProposal {
  id: number;
  target_url: string;
  proposed_by_actor_type: "human" | "agent"; // Removed system proposals
  proposed_by_actor_id: number;
  endpoint_id?: number;
  collection_id?: number;
  // "resolved" is the historical terminal value (9 rows predating the
  // approved/rejected split -- see source_proposal_resolution_authority.sql);
  // mcp_resolve_source_proposal now writes "approved"/"rejected" instead.
  status: "submitted" | "resolved" | "approved" | "rejected";
}

export interface SourcePolicyDecision {
  id: number;
  endpoint_id?: number;
  collection_id?: number;
  trust_mode: TrustMode;
  rights_class: RightsClass;
  rights_identifier?: string;
  rights_uri?: string;
  evidence_snapshot: EvidenceSnapshot; // Strongly typed
  carta_version: string;
  decided_by_actor_type: "system" | "human";
  decided_by_actor_id: number | null; // Nullable bigint (null when system)
  reason: string;
}

// ----------------------------------------------------------------------------
// Phase 2A: Seed Representation of Existing Whitelist
// Exactly matching the deterministic Python whitelist into the relational model.
// ----------------------------------------------------------------------------

export const SEED_INSTITUTIONS: SourceInstitution[] = [
  { id: 1, slug: "gutenberg", name: "Project Gutenberg", primary_languages: ["en"] },
  { id: 2, slug: "runeberg", name: "Project Runeberg", primary_languages: ["sv", "no", "da"] },
  { id: 3, slug: "wikimedia", name: "Wikimedia Foundation", primary_languages: ["mul"] },
  { id: 4, slug: "archive-org", name: "Internet Archive", primary_languages: ["mul"] }
];

export const SEED_ENDPOINTS: SourceEndpoint[] = [
  { id: 1, institution_id: 1, host_pattern: "gutenberg.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
  { id: 2, institution_id: 1, host_pattern: "www.gutenberg.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
  { id: 3, institution_id: 1, host_pattern: "gutendex.com", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
  { id: 4, institution_id: 2, host_pattern: "runeberg.org", match_type: "exact", status: "active", trust_mode: "domain_trusted" },
  { id: 5, institution_id: 3, host_pattern: ".wikisource.org", match_type: "suffix", status: "active", trust_mode: "domain_trusted" },
  { id: 6, institution_id: 3, host_pattern: ".wikipedia.org", match_type: "suffix", status: "active", trust_mode: "domain_trusted" },
  // Exact legacy semantics: .wikimedia.org is a pure ALLOWED_SUFFIXES domain_trusted with mixed licensing,
  // without any custom api access rules or item verification requirement.
  { id: 7, institution_id: 3, host_pattern: ".wikimedia.org", match_type: "suffix", status: "active", trust_mode: "domain_trusted" },
  { id: 8, institution_id: 4, host_pattern: "archive.org", match_type: "exact", status: "active", trust_mode: "item_verified" },
  { id: 9, institution_id: 4, host_pattern: "www.archive.org", match_type: "exact", status: "active", trust_mode: "item_verified" }
];

export const SEED_ACCESS_RULES: SourceAccessRule[] = [
  { id: 1, endpoint_id: 8, allowed_hosts: ["archive.org"], path_patterns: [], collection_identifiers: [], api_endpoints: ["https://archive.org/metadata/"], verification_strategy: "archive_org_metadata", expected_redirect_hosts: [] },
  { id: 2, endpoint_id: 9, allowed_hosts: ["www.archive.org"], path_patterns: [], collection_identifiers: [], api_endpoints: ["https://archive.org/metadata/"], verification_strategy: "archive_org_metadata", expected_redirect_hosts: [] }
];

const mock_evidence: EvidenceSnapshot = { rights_scope_type: "endpoint", rights_statement_hash: "mock", rights_class: "public_domain" };
const decided_by = { decided_by_actor_type: "system" as const, decided_by_actor_id: null };

export const SEED_DECISIONS: SourcePolicyDecision[] = [
  { id: 1, endpoint_id: 1, trust_mode: "domain_trusted", rights_class: "public_domain", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Gutenberg is entirely PD.", evidence_snapshot: mock_evidence },
  { id: 2, endpoint_id: 2, trust_mode: "domain_trusted", rights_class: "public_domain", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Gutenberg is entirely PD.", evidence_snapshot: mock_evidence },
  { id: 3, endpoint_id: 3, trust_mode: "domain_trusted", rights_class: "public_domain", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Gutenberg is entirely PD.", evidence_snapshot: mock_evidence },
  { id: 4, endpoint_id: 4, trust_mode: "domain_trusted", rights_class: "public_domain", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Runeberg is entirely PD.", evidence_snapshot: mock_evidence },
  { id: 5, endpoint_id: 5, trust_mode: "domain_trusted", rights_class: "public_domain", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Wikisource suffix is PD.", evidence_snapshot: mock_evidence },
  { id: 6, endpoint_id: 6, trust_mode: "domain_trusted", rights_class: "creative_commons", rights_identifier: "CC-BY-SA-4.0", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Wikipedia suffix is CC-BY-SA-4.0.", evidence_snapshot: { ...mock_evidence, rights_class: "creative_commons" } },
  { id: 7, endpoint_id: 7, trust_mode: "domain_trusted", rights_class: "mixed", rights_identifier: "per-file (PD/CC, verified)", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Wikimedia Commons is per-file PD/CC.", evidence_snapshot: { ...mock_evidence, rights_class: "mixed" } },
  { id: 8, endpoint_id: 8, trust_mode: "item_verified", rights_class: "mixed", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Internet Archive requires per-item metadata validation.", evidence_snapshot: { ...mock_evidence, rights_class: "mixed" } },
  { id: 9, endpoint_id: 9, trust_mode: "item_verified", rights_class: "mixed", carta_version: "0.7", ...decided_by, reason: "Legacy whitelist: Internet Archive requires per-item metadata validation.", evidence_snapshot: { ...mock_evidence, rights_class: "mixed" } }
];

/**
 * Deterministic Trust Resolver (Phase 2A Simulation Engine).
 * Proves that the new relational domain model perfectly captures the legacy 
 * hardcoded whitelist rules without altering their security boundaries.
 */
export function resolveTrust(url: string, endpoints: readonly SourceEndpoint[] = SEED_ENDPOINTS) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // Invalid URL
  }
  
  const host = parsed.host.toLowerCase();

  // 1. Try exact matches first
  let endpoint = endpoints.find(e => e.match_type === "exact" && e.host_pattern === host);
  
  // 2. Try suffix matches if no exact match (must match .suffix exactly, not just substring)
  if (!endpoint) {
    endpoint = endpoints.find(e => e.match_type === "suffix" && host.endsWith(e.host_pattern));
  }

  // 3. Not found in governance registry -> rejected
  if (!endpoint || endpoint.status !== "active") return null;

  const rule = SEED_ACCESS_RULES.find(r => r.endpoint_id === endpoint!.id) || { verification_strategy: "none" };
  const decision = SEED_DECISIONS.find(d => d.endpoint_id === endpoint!.id);

  return {
    endpoint,
    rule,
    decision
  };
}

// ----------------------------------------------------------------------------
// The live registry: what an editor's approval actually does.
//
// The seeds above are the nine hosts the hardcoded whitelist has always
// known. Approving a source through the Desk or the Telegram button writes a
// row to `source_endpoints` — and until this, nothing that ENFORCES trust
// read that table, so an approval was a record with no effect (eight
// sources, PARES among them, sat approved and unusable). effectiveEndpoints()
// is the join between the two: what the database says is active, restricted
// to approvals that are actually safe to act on.
// ----------------------------------------------------------------------------

/** One approval as the registry read reports it. */
export interface RegistryRow {
  id: number;
  institution_id: number | null;
  host_pattern: string;
  match_type: MatchType;
  status: LifecycleStatus;
  trust_mode: TrustMode | null;
  /** rights_class of this endpoint's newest APPROVE decision; null if none. */
  rights_class: RightsClass | null;
}

// A host as a hostname, not as anything a URL parser could read differently:
// lowercase labels, no userinfo/port/path/query, at least two labels. A stored
// pattern that is not this can never equal a parsed URL host, so it must not
// be able to match by suffix either.
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const EXACT_HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const SUFFIX_HOST_RE = new RegExp(`^\\.${LABEL}(?:\\.${LABEL})+$`);

/**
 * A registry pattern the resolver may match against. A suffix pattern must be
 * a dot plus at least two labels: `endsWith("com")` would trust every .com
 * host and `endsWith("")` every host at all, so a row like that — however it
 * got into the table — is inert rather than catastrophic.
 */
export function isWellFormedPattern(matchType: MatchType, hostPattern: string): boolean {
  if (matchType === "exact") return EXACT_HOST_RE.test(hostPattern);
  if (matchType === "suffix") return SUFFIX_HOST_RE.test(hostPattern);
  return false;
}

/**
 * Whether a registry row may act as an endpoint. Fail-closed on every axis:
 *
 *  - only `active` endpoints (retired/quarantined/needs_human_review never),
 *    and only with a well-formed host pattern;
 *  - only trust modes this layer can honour by host alone. `domain_trusted`
 *    (the whole domain) and `item_verified` (host governed; the item is
 *    verified at the Curator). `collection_trusted` needs a collection
 *    match this layer does not perform, and `link_only` means "cite, never
 *    ingest" — neither may be fetched on the strength of the host;
 *  - an approval must be IN FORCE: the row's newest decision is an approve
 *    (rights_class is null otherwise) and its rights are not `in_copyright`;
 *  - a `domain_trusted` approval additionally needs a KNOWN rights class.
 *    "This whole domain is safe to ingest unattended" cannot rest on
 *    "rights: unknown"; that approval stays on record and inert until an
 *    editor settles the rights, rather than quietly becoming live authority.
 *    (item_verified may carry `unknown` at the endpoint level: its rights
 *    are established per item, which is the point of the mode.)
 */
export function isEffective(row: RegistryRow): boolean {
  if (row.status !== "active") return false;
  if (!isWellFormedPattern(row.match_type, row.host_pattern)) return false;
  if (row.rights_class === null || row.rights_class === "in_copyright") return false;
  if (row.trust_mode === "item_verified") return true;
  if (row.trust_mode === "domain_trusted") return row.rights_class !== "unknown";
  return false;
}

/**
 * The endpoints in force: the seed floor, corrected by the registry, plus
 * every effective registry row. For a seed host:
 *
 *  - no registry row at all → kept. An empty or partial registry never leaves
 *    the site trusting LESS than the hardcoded whitelist it has always
 *    enforced (the registry can add trust through an approval a human made;
 *    it is not required to re-state the nine hosts to keep them);
 *  - a row that is not active (quarantined, retired, under review) → dropped:
 *    revocation must work, or approval would be a one-way ratchet;
 *  - an active row → the REGISTRY's trust mode governs, so an editor
 *    downgrading `.wikimedia.org` to link_only takes it out of fetching. A
 *    downgrade to a mode this layer cannot honour by host alone, or a rights
 *    class of in_copyright, drops the host.
 */
export function effectiveEndpoints(rows: readonly RegistryRow[]): SourceEndpoint[] {
  const byKey = new Map<string, RegistryRow>();
  for (const r of rows) byKey.set(`${r.match_type}:${r.host_pattern}`, r);

  const out: SourceEndpoint[] = [];
  for (const seed of SEED_ENDPOINTS) {
    const live = byKey.get(`${seed.match_type}:${seed.host_pattern}`);
    if (!live) {
      out.push(seed);
      continue;
    }
    if (live.status !== "active") continue;
    if (live.rights_class === "in_copyright") continue;
    if (live.trust_mode !== "domain_trusted" && live.trust_mode !== "item_verified") continue;
    out.push({ ...seed, trust_mode: live.trust_mode });
  }
  const seedKeys = new Set(SEED_ENDPOINTS.map(e => `${e.match_type}:${e.host_pattern}`));
  for (const r of rows) {
    if (seedKeys.has(`${r.match_type}:${r.host_pattern}`)) continue;
    if (!isEffective(r)) continue;
    out.push({
      id: r.id,
      institution_id: r.institution_id ?? 0,
      host_pattern: r.host_pattern,
      match_type: r.match_type,
      status: "active",
      trust_mode: r.trust_mode,
    });
  }
  return out;
}