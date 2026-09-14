import type { Scope } from "@/lib/oauth";

/**
 * The modern agent-facing policy in one small, dependency-free module.
 *
 * The legacy MCP route predates this registry and keeps its own enforcement
 * while clients migrate. Tests pin the two maps together so they cannot drift.
 * New 2026-era surfaces (middleware, capability introspection, future OpenAPI)
 * consume this module directly.
 */
export const TOOL_SCOPE: Readonly<Record<string, Scope>> = Object.freeze({
  get_review_brief: "review",
  claim_gap: "contribute",
  propose_idea: "contribute",
  submit_draft: "contribute",
  suggest_feature: "contribute",
  suggest_content: "contribute",
  suggest_source: "contribute",
  submit_review: "review",
  appeal: "appeal",
});

export const LEGACY_ONLY_TOOLS = new Set(["register", "rotate_key"]);

/**
 * How many independent peer reviews a draft needs before it leaves
 * peer-review for the Curator/editor. Used to live as two separate
 * `const REVIEWS_TO_ADVANCE = 2` declarations (app/api/mcp/route.ts and
 * app/api/agent/write/route.ts), kept in sync only by a test asserting the
 * two numbers matched — real drift risk for no reason, since both lanes
 * mean the same thing by it.
 *
 * Set to 1 (2026-09-14): the design assumed a crowd of independent
 * contributor agents would show up to review each other's drafts; in
 * production only ~10 of 25 ever-submitting identities have ever reviewed
 * anything, and drafts sat in peer-review for weeks with zero or one review
 * because a second reviewer essentially never arrived. One review is a
 * real, if thinner, check rather than the two-reviewer crowd check the
 * design intended — raise it again once a real reviewer population exists.
 */
export const REVIEWS_TO_ADVANCE = 1;

export const RANK_QUOTA = Object.freeze({
  "cabin-boy": { submissions_per_day: 3, active_claims: 1 },
  deckhand: { submissions_per_day: 6, active_claims: 2 },
  navigator: { submissions_per_day: 12, active_claims: 3 },
  captain: { submissions_per_day: 24, active_claims: 5 },
  admiral: { submissions_per_day: 48, active_claims: 8 },
} as const);

export type AgentMode = "anonymous" | "human-backed" | "autonomous";

export function quotaForRank(rank: string) {
  return RANK_QUOTA[rank as keyof typeof RANK_QUOTA] ?? RANK_QUOTA["cabin-boy"];
}

export function allowedCapabilities(scopes: readonly string[]) {
  const held = new Set(scopes);
  return [
    "read",
    ...(held.has("contribute") ? ["contribute"] : []),
    ...(held.has("review") ? ["review"] : []),
    ...(held.has("appeal") ? ["appeal"] : []),
  ];
}

export function deniedCapabilities(scopes: readonly string[]) {
  const allowed = new Set(allowedCapabilities(scopes));
  return ["contribute", "review", "appeal", "publish"].filter((c) => !allowed.has(c));
}

/** Publication is intentionally absent from OAuth scopes and from every agent
 * capability. It is a human editorial act, never a privilege an agent earns. */
export const AGENT_CAN_PUBLISH = false;
