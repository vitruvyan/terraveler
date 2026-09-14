import type { Metadata } from "next";
import Link from "next/link";
import TitlePage from "@/components/TitlePage";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChartroomBoard from "@/components/ChartroomBoard";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";
import { adaptEditorialGap, type ChartroomWaypoint, type LegacyEditorialGap, type WaypointType } from "@/lib/chartroom";

export const metadata: Metadata = {
  title: "The Chartroom",
  description:
    "Evolve the existing Chartroom into Terraveler's public contribution board and primary human onboarding surface.",
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

interface CategoryInfo {
  id: string;
  label: string;
  description: string;
  types: WaypointType[];
}

const ALL_CATEGORIES: CategoryInfo[] = [
  { id: "all", label: "All Work", description: "All available opportunities.", types: [] },
  { id: "stories", label: "Stories", description: "Narrative improvements and missing voyage material.", types: ["narrative", "translation"] },
  { id: "images", label: "Images", description: "Historical images, engravings, maps and visual evidence.", types: ["image"] },
  { id: "peoples", label: "Peoples & Encounters", description: "Historical and cultural context around encounters represented in voyages.", types: ["challenge"] },
  { id: "places", label: "Places", description: "Historical locations, coordinates and geographical verification.", types: ["map", "claim"] },
  { id: "sources", label: "Sources", description: "Better sources, transcription, source verification and cross-references.", types: ["source", "transcription"] },
  { id: "topics", label: "Topics", description: "Themes that could connect multiple voyages.", types: [] },
  { id: "review", label: "Review", description: "Evidence checking, challenges and editorial verification.", types: ["review"] },
];

const contributionStages = [
  {
    step: "01",
    eyebrow: "Discover",
    title: "Choose something worth improving",
    body: "Browse open work across stories, images, places, sources, peoples and topics. Start with something that genuinely interests you.",
    detail: "You can explore before signing in.",
  },
  {
    step: "02",
    eyebrow: "Contribute",
    title: "Claim it, then work from a clear brief",
    body: "Each opportunity tells you what is missing, why it matters and what evidence the atlas expects. Research, create and cite your sources.",
    detail: "The brief defines the work — not Terraveler's internal machinery.",
  },
  {
    step: "03",
    eyebrow: "Publish",
    title: "Submit it for human editorial review",
    body: "A curator checks the evidence and editorial fit. Accepted work enters the atlas with its provenance preserved.",
    detail: "Nothing goes public automatically.",
  },
];

export default async function Chartroom({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const filter = parseFilter(resolvedParams);
  const contextual = Boolean(filter.voyage && filter.waypoint);
  const loaded = await getWaypoints(filter);
  const waypoints = loaded.waypoints;

  const category = (Array.isArray(resolvedParams.category) ? resolvedParams.category[0] : resolvedParams.category) || "all";
  const tab = (Array.isArray(resolvedParams.tab) ? resolvedParams.tab[0] : resolvedParams.tab) || "open";

  const categoryMeta = ALL_CATEGORIES.find((c) => c.id === category) || ALL_CATEGORIES[0];

  const allWaypoints = waypoints || [];
  const categoryFiltered = categoryMeta.id === "all"
    ? allWaypoints
    : allWaypoints.filter((wp) => categoryMeta.types.includes(wp.type));

  const openWaypoints = categoryFiltered.filter((wp) => wp.status === "open" && wp.requestedVoyager === null);
  const progressWaypoints = categoryFiltered.filter((wp) => wp.status === "taken" || wp.requestedVoyager !== null);

  const displayWaypoints = tab === "progress" ? progressWaypoints : openWaypoints;

  const openCount = openWaypoints.length;
  const progressCount = progressWaypoints.length;

  const onboarding = contextual ? null : (
    <section id="how-it-works" style={{ marginTop: 34, marginBottom: 12 }}>
      <div style={{ maxWidth: 760, marginBottom: 24 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-mono)",
            fontSize: "0.72rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--brass-text)",
            marginBottom: 8,
          }}
        >
          Your first contribution
        </span>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(1.8rem, 4vw, 2.7rem)",
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          Start with a missing piece of the atlas.
        </h2>
        <p className="ed-muted" style={{ fontSize: "1rem", lineHeight: 1.65, marginTop: 12, maxWidth: 680 }}>
          You do not need to learn Terraveler&apos;s workflow before you begin. Find a useful piece of work,
          follow its brief, and let the editorial process take care of the rest.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          borderTop: "1px solid var(--rule-hair)",
          borderBottom: "1px solid var(--rule-hair)",
        }}
      >
        {contributionStages.map((stage, index) => (
          <article
            key={stage.step}
            style={{
              padding: "22px 22px 24px 0",
              marginRight: index < contributionStages.length - 1 ? 22 : 0,
              borderRight: index < contributionStages.length - 1 ? "1px solid var(--rule-hair)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--brass-text)" }}>
                {stage.step}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "0.76rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                }}
              >
                {stage.eyebrow}
              </span>
            </div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.45rem", lineHeight: 1.1, margin: "0 0 10px" }}>
              {stage.title}
            </h3>
            <p className="ed-muted" style={{ fontSize: "0.9rem", lineHeight: 1.55, margin: 0 }}>
              {stage.body}
            </p>
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "0.78rem",
                lineHeight: 1.45,
                color: "var(--ink-soft)",
                margin: "14px 0 0",
              }}
            >
              {stage.detail}
            </p>
          </article>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 14px",
          marginTop: 18,
          fontFamily: "var(--font-ui)",
          fontSize: "0.82rem",
          color: "var(--ink-soft)",
        }}
      >
        <strong style={{ color: "var(--ink)" }}>The full path</strong>
        <span>Find</span><span aria-hidden="true">→</span>
        <span>Claim</span><span aria-hidden="true">→</span>
        <span>Research &amp; create</span><span aria-hidden="true">→</span>
        <span>Submit</span><span aria-hidden="true">→</span>
        <span>Review</span>
      </div>
    </section>
  );

  return (
    <>
      <SiteHeader />
      <TitlePage
        eyebrow="Help build the atlas"
        title="The Chartroom"
        dek={contextual
          ? `Waypoints attached to ${filter.voyage}, stop ${filter.waypoint}. This is the same work surfaced by Contribute in the Atlas.`
          : "Terraveler is never completely finished. Some voyages need better sources. Some need images. Some encounters need historical context. Choose something that interests you and help improve it."}
        background="/login-backgrounds/carta-marina.png"
        credit="Carta Marina · 1539 · Olaus Magnus"
        actions={[
          { href: "#open-opportunities", label: "Find something to contribute" },
          { href: "#how-it-works", label: "How contributing works", variant: "secondary" as const },
        ]}
        meta={["Shared backlog", "Independent standing", "Human editorial decision"]}
        beforePlate={onboarding}
      >
        <section id="open-opportunities" style={{ marginTop: 42 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginBottom: 12 }}>
            What the Atlas Needs
          </h2>
          <p className="ed-muted" style={{ marginBottom: 24 }}>
            Explore the public roadmap and choose an opportunity to work on. Select a category to filter.
          </p>

          <div className="tv-tabs" role="tablist" style={{ marginBottom: 20 }}>
            {ALL_CATEGORIES.map((cat) => {
              const isActive = category === cat.id;
              const params = new URLSearchParams();
              if (cat.id !== "all") params.set("category", cat.id);
              if (tab !== "open") params.set("tab", tab);
              const href = `/contribute?${params.toString()}#open-opportunities`;

              return (
                <Link
                  key={cat.id}
                  href={href}
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? "tv-tab tv-tab-on" : "tv-tab"}
                  style={{ textDecoration: "none" }}
                >
                  {cat.label}
                </Link>
              );
            })}
          </div>

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
          ) : (
            <ChartroomBoard
              initial={displayWaypoints}
              category={category}
              tab={tab}
              openCount={openCount}
              progressCount={progressCount}
            />
          )}
        </section>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
