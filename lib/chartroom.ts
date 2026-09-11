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
