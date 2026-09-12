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
  status: "submitted" | "resolved";
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
export function resolveTrust(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // Invalid URL
  }
  
  const host = parsed.host.toLowerCase();

  // 1. Try exact matches first
  let endpoint = SEED_ENDPOINTS.find(e => e.match_type === "exact" && e.host_pattern === host);
  
  // 2. Try suffix matches if no exact match (must match .suffix exactly, not just substring)
  if (!endpoint) {
    endpoint = SEED_ENDPOINTS.find(e => e.match_type === "suffix" && host.endsWith(e.host_pattern));
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