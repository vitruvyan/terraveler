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

const CLIENT_COMPATIBILITY_PREAMBLE = `Before starting, determine what this CURRENT client can actually do. Terraveler supports a remote MCP endpoint at https://www.terraveler.com/api/mcp, but not every ChatGPT, Claude or other chat surface can attach arbitrary remote MCP servers.

Preferred path: if this client supports remote MCP, connect to https://www.terraveler.com/api/mcp and use the Terraveler tools directly.

Compatibility path: if remote MCP is unavailable but this environment can make arbitrary HTTPS requests, use Terraveler's HTTP agent surfaces instead. Public atlas reads are available over GET at https://www.terraveler.com/api/atlas. Governed writes use OAuth plus POST https://www.terraveler.com/api/agent/write with a JSON body of {"name":"<tool>","arguments":{...}}. Full connection instructions are at https://www.terraveler.com/connect.

If this client supports neither remote MCP nor authenticated HTTP POST requests, do NOT pretend Terraveler is unreachable and do NOT fabricate any tool call. Explain that the limitation belongs to the current client, not Terraveler, and direct the human to https://www.terraveler.com/connect. For ChatGPT, use Work or a connected/custom MCP app when available. Then stop before claiming or submitting anything.`;

/**
 * Builds the canonical onboarding prompt for agents.
 * This is the single source of truth for agent instructions.
 */
export function buildAgentOnboardingPrompt(waypointId?: number): string {
  const targetText = waypointId
    ? `Claim open Waypoint #${waypointId} and work on it.`
    : `List open Waypoints using '${CHARTROOM_MCP_CAPABILITIES.ongoing.list}', choose an open one, claim it, and work on it.`;

  return `${CLIENT_COMPATIBILITY_PREAMBLE}\n\nYour goal is to contribute to the Terraveler geo-historical atlas. Follow these steps:\n1. Call 'get_contract' to read the contribution agreement and follow the Magna Carta of the Seas strictly.\n2. ${targetText}\n3. Use '${CHARTROOM_MCP_CAPABILITIES.ongoing.claim}' to claim the waypoint before starting.\n4. Perform the research using high-quality public domain sources (Project Gutenberg, Wikisource, Wikimedia Commons, Archive.org). Always cite verbatim, quote accurately, and provide exact URLs. Never fabricate.\n5. Submit your contribution draft using '${CHARTROOM_MCP_CAPABILITIES.ongoing.submit}'.\n\nCarry steps 1-5 through end-to-end on your own — none of these tools require my confirmation between calls, so do not pause to ask for it. Only stop and ask me if you hit something no tool can resolve: a genuine scope judgment, a source-integrity question, a missing credential, or a client capability limitation described above.`;
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

  return `${CLIENT_COMPATIBILITY_PREAMBLE}\n\nYour goal is to propose ONE meaningful addition that does not already exist in the Terraveler atlas.\n1. Call 'get_contract' and follow the Magna Carta of the Seas strictly.\n2. Inspect the existing atlas and current open Waypoints before proposing anything. Do not duplicate existing work.\n3. ${categoryHint}\n4. Identify a concrete missing subject, story, image set, people/encounter perspective, place, cross-voyage topic, or review need.\n5. Explain briefly: what should be added, why it matters, what existing voyage/content it connects to, and what evidence could support it.\n6. Submit only the proposal using '${CHARTROOM_MCP_CAPABILITIES.propose.create}'. Do not create a full draft unless the proposal is later accepted as work.\n\nFor a new knowledge source use the dedicated Source workflow and '${CHARTROOM_MCP_CAPABILITIES.sources.propose}' instead of a generic content proposal.\n\nNever fabricate sources, quotations, historical claims, or a gap that the atlas already covers.`;
}

/**
 * Canonical prompt for source discovery. Sources are epistemic infrastructure,
 * not ordinary content ideas: an agent must verify provenance, language,
 * edition and admissibility before proposing one.
 */
export function buildAgentSourceProposalPrompt(): string {
  return `${CLIENT_COMPATIBILITY_PREAMBLE}\n\nYour task is to propose ONE credible knowledge source that could strengthen the Terraveler atlas.\n1. Call 'get_contract' and follow the Magna Carta of the Seas strictly.\n2. Call '${CHARTROOM_MCP_CAPABILITIES.sources.list}' and inspect Terraveler's current trusted source endpoints before proposing anything. If relevant, call '${CHARTROOM_MCP_CAPABILITIES.sources.listProposals}' too so you do not duplicate a proposal already under review.\n3. Inspect the existing atlas and open Waypoints to understand where the source would add value.\n4. Prefer primary sources, scholarly critical editions, peer-reviewed scholarship, national or institutional archives, museums, libraries, universities, or reputable public-domain / openly licensed collections.\n5. Verify the source before proposing it: exact URL or stable archive identifier, author or institution, date where known, source type, rights/access status, original language, and any translation or edition you are relying on.\n6. Sources may be in ANY language. Terraveler currently publishes narrative content in English, so explicitly distinguish the original language from the language of the edition or translation consulted.\n7. Explain what voyage, waypoint, region, person, people/encounter, topic or disputed claim the source could strengthen and why it is materially useful.\n8. Do not use search-engine snippets, unattributed webpages, anonymous blogs, AI-generated summaries, unsourced social posts, or a secondary page that merely repeats another source as evidence.\n9. Submit the source through the dedicated '${CHARTROOM_MCP_CAPABILITIES.sources.propose}' tool. Do NOT use '${CHARTROOM_MCP_CAPABILITIES.propose.create}' for a source proposal. Do not ingest or publish it unless Source Governance later accepts it.\n\nNever fabricate provenance, quotations, archive metadata, translations, dates, identifiers, or access rights.`;
}
