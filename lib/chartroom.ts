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
 * Builds the canonical onboarding prompt for agents.
 * This is the single source of truth for agent instructions.
 */
export function buildAgentOnboardingPrompt(waypointId?: number): string {
  const targetText = waypointId
    ? `Claim open Waypoint #${waypointId} and work on it.`
    : `List open Waypoints using 'list_gaps', choose an open one, claim it, and work on it.`;

  return `Connect to the Terraveler remote MCP server: https://www.terraveler.com/api/mcp

Your goal is to contribute to the Terraveler geo-historical atlas. Follow these steps:
1. Call 'get_contract' to read the contribution agreement and follow the Magna Carta of the Seas strictly.
2. ${targetText}
3. Use 'claim_gap' to claim the waypoint before starting.
4. Perform the research using high-quality public domain sources (Project Gutenberg, Wikisource, Wikimedia Commons, Archive.org). Always cite verbatim, quote accurately, and provide exact URLs. Never fabricate.
5. Submit your contribution draft using 'submit_draft'.

Carry steps 1-5 through end-to-end on your own — none of these tools require my confirmation between calls, so do not pause to ask for it. Only stop and ask me if you hit something no tool can resolve: a genuine scope judgment, a source-integrity question, or a missing credential.`;
}

/**
 * Canonical prompt for agents asked to identify new work rather than execute an
 * existing Waypoint. Proposals remain proposals: the editorial desk decides
 * whether they become Chartroom work.
 */
export function buildAgentProposalPrompt(category = "all"): string {
  const categoryHint = category && category !== "all"
    ? `Focus on the public Chartroom category '${category}'.`
    : "Choose the area where you can identify the strongest meaningful gap.";

  return `Connect to the Terraveler remote MCP server: https://www.terraveler.com/api/mcp

Your goal is to propose ONE meaningful addition that does not already exist in the Terraveler atlas.
1. Call 'get_contract' and follow the Magna Carta of the Seas strictly.
2. Inspect the existing atlas and current open Waypoints before proposing anything. Do not duplicate existing work.
3. ${categoryHint}
4. Identify a concrete missing subject, story, image set, people/encounter perspective, place, source corpus, cross-voyage topic, or review need.
5. Explain briefly: what should be added, why it matters, what existing voyage/content it connects to, and what evidence could support it.
6. Submit only the proposal using 'propose_idea'. Do not create a full draft unless the proposal is later accepted as work.

Never fabricate sources, quotations, historical claims, or a gap that the atlas already covers.`;
}
