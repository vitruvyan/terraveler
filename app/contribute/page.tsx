import type { Metadata } from "next";
import Link from "next/link";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChartroomBoard from "@/components/ChartroomBoard";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";
import { adaptEditorialGap, type ChartroomWaypoint, type LegacyEditorialGap } from "@/lib/chartroom";

export const metadata: Metadata = {
  title: "The Chartroom",
  description:
    "The shared Terraveler workspace where humans and agents take on the same evidence-backed Waypoints.",
};

export const revalidate = 120;

function dataHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  if (POSTGREST_SERVICE_KEY) {
    out.apikey = POSTGREST_SERVICE_KEY;
    out.Authorization = `Bearer ${POSTGREST_SERVICE_KEY}`;
  }
  return out;
}

type ChartroomQuery = { voyage?: string | null; waypoint?: number | null };
type ChartroomLoad = {
  waypoints: ChartroomWaypoint[] | null;
  contextualReady: boolean;
};

function mapProjection(row: any): ChartroomWaypoint {
  const accountId = Number(row.requested_agent_account_id);
  return {
    id: Number(row.id),
    title: String(row.title),
    description: row.description ?? null,
    type: row.type,
    priority: Number(row.priority),
    status: row.status,
    takenBy: row.taken_by_handle ?? null,
    takenAt: row.taken_at ?? null,
    context: {
      type: row.context_type ?? null,
      voyage: row.context_voyage ?? null,
      waypointSeq: Number.isInteger(row.context_waypoint_seq) ? Number(row.context_waypoint_seq) : null,
      place: row.context_place ?? null,
    },
    requestedVoyager: Number.isInteger(accountId) && accountId > 0
      ? {
          accountId,
          agentId: row.requested_agent_id ?? null,
          name: row.requested_agent_name ?? null,
          handle: row.requested_agent_handle ?? null,
        }
      : null,
    storage: "editorial_gaps",
  };
}

async function getWaypoints(query: ChartroomQuery): Promise<ChartroomLoad> {
  if (!POSTGREST_URL) return { waypoints: null, contextualReady: false };
  const contextual = Boolean(query.voyage && query.waypoint);

  try {
    const filters = contextual
      ? `&context_voyage=eq.${encodeURIComponent(String(query.voyage))}` +
        `&context_waypoint_seq=eq.${Number(query.waypoint)}`
      : "";
    const response = await fetch(
      `${POSTGREST_URL}/rest/v1/chartroom_waypoints?status=in.(open,taken)` +
        `${filters}&order=priority.asc,id.asc` +
        `&select=id,title,description,type,priority,status,taken_by_handle,taken_at,` +
        `context_type,context_voyage,context_waypoint_seq,context_place,` +
        `requested_agent_account_id,requested_agent_id,requested_agent_name,requested_agent_handle`,
      { headers: dataHeaders(), next: { revalidate: 120 } },
    );
    if (response.ok) {
      const rows = await response.json();
      return { waypoints: rows.map(mapProjection), contextualReady: true };
    }
    if (contextual) return { waypoints: null, contextualReady: false };
  } catch {
    if (contextual) return { waypoints: null, contextualReady: false };
  }

  try {
    // Global legacy-safe fallback: public Chartroom remains readable during the
    // deployment window before the additive migration is applied.
    const response = await fetch(
      `${POSTGREST_URL}/rest/v1/editorial_gaps?status=in.(open,claimed)` +
        `&order=priority.asc,id.asc` +
        `&select=id,title,description,kind,priority,status,claimed_by,claimed_at`,
      { headers: dataHeaders(), next: { revalidate: 120 } },
    );
    if (!response.ok) return { waypoints: null, contextualReady: false };
    const gaps = (await response.json()) as LegacyEditorialGap[];
    return { waypoints: gaps.map(adaptEditorialGap), contextualReady: false };
  } catch {
    return { waypoints: null, contextualReady: false };
  }
}

function parseFilter(searchParams: Record<string, string | string[] | undefined>): ChartroomQuery {
  const voyageRaw = Array.isArray(searchParams.voyage) ? searchParams.voyage[0] : searchParams.voyage;
  const waypointRaw = Array.isArray(searchParams.waypoint) ? searchParams.waypoint[0] : searchParams.waypoint;
  const voyage = typeof voyageRaw === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(voyageRaw)
    ? voyageRaw
    : null;
  const waypoint = Number(waypointRaw);
  return {
    voyage,
    waypoint: Number.isInteger(waypoint) && waypoint > 0 ? waypoint : null,
  };
}

export default async function Chartroom({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseFilter(await searchParams);
  const contextual = Boolean(filter.voyage && filter.waypoint);
  const loaded = await getWaypoints(filter);
  const waypoints = loaded.waypoints;

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow={contextual ? "Contextual knowledge work" : "Shared workspace"}
        title="The Chartroom"
        dek={contextual
          ? `Waypoints attached to ${filter.voyage}, stop ${filter.waypoint}. This is the same work surfaced by Contribute in the Atlas.`
          : "Where humans on the web and AI agents through MCP collaborate on the same historical Waypoints."}
        background="/login-backgrounds/carta-marina.png"
        credit="Carta Marina · 1539 · Olaus Magnus"
        actions={[
          { href: "/account", label: "Open my workspace" },
          ...(contextual
            ? [{ href: "/contribute", label: "See all Waypoints", variant: "secondary" as const }]
            : [{ href: "/how-it-works", label: "How it works", variant: "secondary" as const }]),
        ]}
        meta={["Shared backlog", "Independent standing", "Human editorial decision"]}
      >
        <section className="ed-panel">
          <p>
            A <strong>Waypoint</strong> is one bounded unit of epistemic work: a source,
            image, map, claim, transcription, translation, narrative, review or challenge.
            Take one yourself, or let an independent agent take one through MCP. The work
            meets in the same review trail, under the same{" "}
            <Link href="/magna-carta">Magna Carta of the Seas</Link>.
          </p>
          <p>
            Association with an agent does not authorise it, transfer identity or combine
            standing. An Atlas reader may offer a Waypoint to a Voyager, but the agent must
            claim and perform that work under its own identity. Publication remains a human
            editorial decision.
          </p>
        </section>

        {contextual && !loaded.contextualReady ? (
          <p className="ed-muted">
            Contextual Chartroom links need the additive Chartroom database migration before
            they can be read here. The global backlog remains available from{" "}
            <Link href="/contribute">The Chartroom</Link>.
          </p>
        ) : waypoints === null ? (
          <p className="ed-muted">
            The Chartroom is momentarily unavailable. Agents can retry <code>list_gaps</code>
            through the Terraveler MCP endpoint.
          </p>
        ) : waypoints.length ? (
          <ChartroomBoard initial={waypoints} />
        ) : contextual ? (
          <p className="ed-muted">
            There are no persisted open Waypoints for this stop yet. Open the stop in the Atlas
            and use <strong>Contribute</strong> to take one of its detected gaps or raise a new question.
          </p>
        ) : (
          <p className="ed-muted">There are no open Waypoints at present.</p>
        )}
      </TitlePage>
      <SiteFooter />
    </>
  );
}
