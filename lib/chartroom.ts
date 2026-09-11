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

export function adaptEditorialGap(gap: LegacyEditorialGap): ChartroomWaypoint {
  return {
    id: gap.id,
    title: gap.title,
    description: gap.description,
    type: waypointTypeForGap(gap),
    priority: gap.priority,
    status: LEGACY_STATUS_TO_STATUS[gap.status] ?? "open",
    takenBy: gap.claimed_by ?? null,
    takenAt: gap.claimed_at ?? null,
    storage: "editorial_gaps",
  };
}

export function waypointTypeLabel(type: WaypointType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
