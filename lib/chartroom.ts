/**
 * The Chartroom's shared vocabulary.
 *
 * `editorial_gaps` remains the storage contract during the incremental
 * migration. Humans reach it through the web and agents through MCP, but both
 * receive the same actor-agnostic Waypoint shape from this adapter.
 *
 * Do not confuse a Chartroom Waypoint (a unit of knowledge work) with the
 * geographic `waypoints` table (a published stop on a voyage).
 */
import { renderPrompt, type PromptMap } from "@/lib/promptRegistry";
export type { PromptMap };

export const WAYPOINT_TYPES = [
  "source",
  "image",
  "map",
  "claim",
  "transcription",
  "translation",
  "narrative",
  "review",
  "challenge",
] as const;

export type WaypointType = (typeof WAYPOINT_TYPES)[number];

export const WAYPOINT_STATUSES = [
  "open",
  "taken",
  "submitted",
  "in_review",
  "changes_requested",
  "accepted",
  "declined",
  "withdrawn",
] as const;

export type WaypointStatus = (typeof WAYPOINT_STATUSES)[number];

export const WAYPOINT_CONTEXT_TYPES = ["atlas", "voyage", "voyage_waypoint"] as const;
export type WaypointContextType = (typeof WAYPOINT_CONTEXT_TYPES)[number];

export type LegacyEditorialGap = {
  id: number;
  title: string;
  description: string | null;
  kind: string;
  priority: number;
  status: string;
  claimed_by?: string | null;
  claimed_at?: string | null;
  waypoint_type?: string | null;
  context_type?: string | null;
  context_voyage?: string | null;
  context_waypoint_seq?: number | null;
  context_place?: string | null;
  requested_agent_account_id?: number | null;
  requested_agent_id?: string | null;
  requested_agent_name?: string | null;
  requested_agent_handle?: string | null;
};

export type ChartroomWaypoint = {
  id: number;
  title: string;
  description: string | null;
  type: WaypointType;
  priority: number;
  status: WaypointStatus;
  takenBy: string | null;
  takenAt: string | null;
  context: {
    type: WaypointContextType | null;
    voyage: string | null;
    waypointSeq: number | null;
    place: string | null;
  };
  requestedVoyager: {
    accountId: number;
    agentId: string | null;
    name: string | null;
    handle: string | null;
  } | null;
  storage: "editorial_gaps";
};

const LEGACY_KIND_TO_TYPE: Record<string, WaypointType> = {
  voyage: "narrative",
  waypoint: "claim",
  media: "image",
  perspective: "challenge",
  translation: "translation",
  correction: "review",
};

const TYPE_TO_LEGACY_KIND: Record<WaypointType, string> = {
  source: "correction",
  image: "media",
  map: "waypoint",
  claim: "waypoint",
  transcription: "correction",
  translation: "translation",
  narrative: "voyage",
  review: "correction",
  challenge: "perspective",
};

const LEGACY_STATUS_TO_STATUS: Record<string, WaypointStatus> = {
  open: "open",
  claimed: "taken",
  done: "accepted",
};

export function waypointTypeForGap(gap: LegacyEditorialGap): WaypointType {
  const explicit = gap.waypoint_type;
  if (explicit && (WAYPOINT_TYPES as readonly string[]).includes(explicit)) {
    return explicit as WaypointType;
  }
  return LEGACY_KIND_TO_TYPE[gap.kind] ?? "claim";
}

export function legacyKindForWaypointType(type: WaypointType): string {
  return TYPE_TO_LEGACY_KIND[type];
}

export function isWaypointType(value: unknown): value is WaypointType {
  return typeof value === "string" && (WAYPOINT_TYPES as readonly string[]).includes(value);
}

function contextType(value: unknown): WaypointContextType | null {
  return typeof value === "string" && (WAYPOINT_CONTEXT_TYPES as readonly string[]).includes(value)
    ? value as WaypointContextType
    : null;
}

export function adaptEditorialGap(gap: LegacyEditorialGap): ChartroomWaypoint {
  const accountId = Number(gap.requested_agent_account_id);
  return {
    id: gap.id,
    title: gap.title,
    description: gap.description,
    type: waypointTypeForGap(gap),
    priority: gap.priority,
    status: LEGACY_STATUS_TO_STATUS[gap.status] ?? "open",
    takenBy: gap.claimed_by ?? null,
    takenAt: gap.claimed_at ?? null,
    context: {
      type: contextType(gap.context_type),
      voyage: gap.context_voyage ?? null,
      waypointSeq: Number.isInteger(gap.context_waypoint_seq) ? Number(gap.context_waypoint_seq) : null,
      place: gap.context_place ?? null,
    },
    requestedVoyager: Number.isInteger(accountId) && accountId > 0
      ? {
          accountId,
          agentId: gap.requested_agent_id ?? null,
          name: gap.requested_agent_name ?? null,
          handle: gap.requested_agent_handle ?? null,
        }
      : null,
    storage: "editorial_gaps",
  };
}

export function waypointTypeLabel(type: WaypointType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Public Chartroom actions and their MCP equivalents.
 * Human UI and agent interface are two views over the same contribution system.
 * Keep this map stable and test it against the live MCP tool catalogue.
 */
export const CHARTROOM_MCP_CAPABILITIES = Object.freeze({
  ongoing: {
    list: "list_gaps",
    claim: "claim_gap",
    submit: "submit_draft",
    status: "get_submission_status",
    audit: "get_audit",
  },
  propose: {
    create: "propose_idea",
  },
  sources: {
    list: "list_sources",
    detail: "get_source",
    propose: "suggest_source",
    listProposals: "list_source_proposals",
    proposalDetail: "get_source_proposal",
  },
  review: {
    list: "list_review_queue",
    detail: "get_review_brief",
    submit: "submit_review",
  },
} as const);

/**
 * Agent-facing prompt text now lives in the versioned registry
 * (supabase/agent_prompts_schema.sql, lib/promptRegistry.ts) instead of
 * here as template literals — it went stale invisibly at least once (an
 * onboarding prompt missing an autonomy instruction, found only after a
 * real agent got stuck on it) and every wording fix needed a deploy. These
 * three stay as PURE render functions: given the prompts already fetched
 * by fetchCurrentPrompts() (do that once, e.g. on mount — never inside the
 * click handler, see lib/promptRegistry.ts), they compute the one or two
 * genuinely dynamic values (which Waypoint, which category) and substitute
 * them into the current version's prose. The functions never fetch
 * anything themselves, so a "Copy Prompt" click still writes to the
 * clipboard synchronously within the user gesture that triggered it.
 *
 * satisfy test/chartroom-mcp-parity.test.ts: buildAgentSourceProposalPrompt
 * satisfy test/chartroom-mcp-parity.test.ts: suggest_source
 * satisfy test/chartroom-mcp-parity.test.ts: Do NOT use propose_idea
 */
export function buildAgentOnboardingPrompt(prompts: PromptMap | null, waypointId?: number): string | null {
  const target = waypointId
    ? `Claim open Waypoint #${waypointId} and work on it.`
    : `List open Waypoints using '${CHARTROOM_MCP_CAPABILITIES.ongoing.list}', choose an open one, claim it, and work on it.`;
  return renderPrompt(prompts, "onboarding", { target });
}

/**
 * Canonical prompt for agents asked to identify new work rather than execute an
 * existing Waypoint. Proposals remain proposals: the editorial desk decides
 * whether they become Chartroom work.
 */
export function buildAgentProposalPrompt(prompts: PromptMap | null, category = "all"): string | null {
  const category_hint = category && category !== "all"
    ? `Focus on the public Chartroom category '${category}'.`
    : "Choose the area where you can identify the strongest meaningful gap.";
  return renderPrompt(prompts, "proposal", { category_hint });
}

/**
 * Canonical prompt for source discovery. Sources are epistemic infrastructure,
 * not ordinary content ideas: an agent must verify provenance, language,
 * edition and admissibility before proposing one.
 */
export function buildAgentSourceProposalPrompt(prompts: PromptMap | null): string | null {
  return renderPrompt(prompts, "source_proposal");
}
