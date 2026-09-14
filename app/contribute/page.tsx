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
  description: "See what Terraveler needs, contribute to ongoing work, or propose what the atlas should explore next.",
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
type ChartroomLoad = { waypoints: ChartroomWaypoint[] | null; contextualReady: boolean };

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
  const voyage = typeof voyageRaw === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(voyageRaw) ? voyageRaw : null;
  const waypoint = Number(waypointRaw);
  return { voyage, waypoint: Number.isInteger(waypoint) && waypoint > 0 ? waypoint : null };
}

interface CategoryInfo {
  id: string;
  label: string;
  description: string;
  types: WaypointType[];
}

const ALL_CATEGORIES: CategoryInfo[] = [
  { id: "all", label: "All", description: "Every kind of work in the Chartroom.", types: [] },
  { id: "stories", label: "Stories", description: "Narratives, missing voyage material and translations.", types: ["narrative", "translation"] },
  { id: "images", label: "Images", description: "Historical images, engravings, maps and visual evidence.", types: ["image"] },
  { id: "peoples", label: "Peoples & Encounters", description: "Historical and cultural context around encounters represented in voyages.", types: ["challenge"] },
  { id: "places", label: "Places", description: "Historical locations, coordinates and geographical verification.", types: ["map", "claim"] },
  { id: "sources", label: "Sources", description: "Better sources, transcription, verification and cross-references.", types: ["source", "transcription"] },
  { id: "topics", label: "Topics", description: "Themes that connect several voyages across the atlas.", types: [] },
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

function buildHref(mode: string, category: string, tab: string) {
  const params = new URLSearchParams();
  if (mode !== "ongoing") params.set("mode", mode);
  if (category !== "all") params.set("category", category);
  if (mode === "ongoing" && tab !== "open") params.set("tab", tab);
  const query = params.toString();
  return `/contribute${query ? `?${query}` : ""}#open-opportunities`;
}

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

  const categoryRaw = Array.isArray(resolvedParams.category) ? resolvedParams.category[0] : resolvedParams.category;
  const category = ALL_CATEGORIES.some((item) => item.id === categoryRaw) ? String(categoryRaw) : "all";
  const tab = (Array.isArray(resolvedParams.tab) ? resolvedParams.tab[0] : resolvedParams.tab) === "progress" ? "progress" : "open";
  const mode = (Array.isArray(resolvedParams.mode) ? resolvedParams.mode[0] : resolvedParams.mode) === "propose" ? "propose" : "ongoing";
  const categoryMeta = ALL_CATEGORIES.find((c) => c.id === category) || ALL_CATEGORIES[0];

  const allWaypoints = waypoints || [];
  const categoryFiltered = categoryMeta.id === "all"
    ? allWaypoints
    : allWaypoints.filter((wp) => categoryMeta.types.includes(wp.type));

  const openWaypoints = categoryFiltered.filter((wp) => wp.status === "open" && wp.requestedVoyager === null);
  const progressWaypoints = categoryFiltered.filter((wp) => wp.status === "taken" || wp.requestedVoyager !== null);
  const displayWaypoints = tab === "progress" ? progressWaypoints : openWaypoints;

  const onboarding = contextual ? null : (
    <section id="how-it-works" style={{ marginTop: 34, marginBottom: 12 }}>
      <div style={{ maxWidth: 760, marginBottom: 24 }}>
        <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brass-text)", marginBottom: 8 }}>
          Your first contribution
        </span>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem, 4vw, 2.7rem)", lineHeight: 1.05, margin: 0 }}>
          Start with a missing piece of the atlas.
        </h2>
        <p className="ed-muted" style={{ fontSize: "1rem", lineHeight: 1.65, marginTop: 12, maxWidth: 680 }}>
          You do not need to learn Terraveler&apos;s workflow before you begin. Find a useful piece of work,
          follow its brief, and let the editorial process take care of the rest.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", borderTop: "1px solid var(--rule-hair)", borderBottom: "1px solid var(--rule-hair)" }}>
        {contributionStages.map((stage, index) => (
          <article key={stage.step} style={{ padding: "22px 22px 24px 0", marginRight: index < contributionStages.length - 1 ? 22 : 0, borderRight: index < contributionStages.length - 1 ? "1px solid var(--rule-hair)" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--brass-text)" }}>{stage.step}</span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.09em" }}>{stage.eyebrow}</span>
            </div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.45rem", lineHeight: 1.1, margin: "0 0 10px" }}>{stage.title}</h3>
            <p className="ed-muted" style={{ fontSize: "0.9rem", lineHeight: 1.55, margin: 0 }}>{stage.body}</p>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "0.78rem", lineHeight: 1.45, color: "var(--ink-soft)", margin: "14px 0 0" }}>{stage.detail}</p>
          </article>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", marginTop: 18, fontFamily: "var(--font-ui)", fontSize: "0.82rem", color: "var(--ink-soft)" }}>
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
          : "Terraveler is never completely finished. Work on what the atlas already needs, or propose what it should explore next."}
        background="/login-backgrounds/carta-marina.png"
        credit="Carta Marina · 1539 · Olaus Magnus"
        actions={[
          { href: "#open-opportunities", label: "Enter the Chartroom" },
          { href: "#how-it-works", label: "How contributing works", variant: "secondary" as const },
        ]}
        meta={["Shared backlog", "Independent standing", "Human editorial decision"]}
        beforePlate={onboarding}
      >
        <section id="open-opportunities" style={{ marginTop: 42 }}>
          <div style={{ maxWidth: 760, marginBottom: 24 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-text)" }}>
              What the atlas needs
            </span>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem, 5vw, 3rem)", margin: "6px 0 10px", lineHeight: 1 }}>
              Work on what exists. Propose what does not.
            </h2>
            <p className="ed-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Ongoing Projects are defined pieces of work ready to be taken. Propose is where humans and AI can suggest subjects the atlas does not cover yet.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 26 }}>
            <Link
              href={buildHref("ongoing", category, tab)}
              aria-current={mode === "ongoing" ? "page" : undefined}
              style={{ textDecoration: "none", color: "inherit", border: mode === "ongoing" ? "1px solid var(--brass)" : "1px solid var(--rule-hair)", background: mode === "ongoing" ? "var(--parchment-raised)" : "transparent", padding: "18px 20px" }}
            >
              <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)", marginBottom: 6 }}>Ongoing Projects</span>
              <strong style={{ display: "block", fontFamily: "var(--font-display)", fontSize: "1.45rem", marginBottom: 5 }}>Choose work that is ready.</strong>
              <span className="ed-muted" style={{ fontSize: "0.88rem", lineHeight: 1.45 }}>Research, images, sources and editorial work already identified by the atlas.</span>
            </Link>
            <Link
              href={buildHref("propose", category, "open")}
              aria-current={mode === "propose" ? "page" : undefined}
              style={{ textDecoration: "none", color: "inherit", border: mode === "propose" ? "1px solid var(--brass)" : "1px solid var(--rule-hair)", background: mode === "propose" ? "var(--parchment-raised)" : "transparent", padding: "18px 20px" }}
            >
              <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)", marginBottom: 6 }}>Propose</span>
              <strong style={{ display: "block", fontFamily: "var(--font-display)", fontSize: "1.45rem", marginBottom: 5 }}>Tell us what is missing.</strong>
              <span className="ed-muted" style={{ fontSize: "0.88rem", lineHeight: 1.45 }}>Suggest a subject, perspective, source set or cross-voyage topic that does not exist yet.</span>
            </Link>
          </div>

          <div className="tv-tabs" role="tablist" aria-label="Contribution categories" style={{ marginBottom: 12 }}>
            {ALL_CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={buildHref(mode, cat.id, tab)}
                role="tab"
                aria-selected={category === cat.id}
                className={category === cat.id ? "tv-tab tv-tab-on" : "tv-tab"}
                style={{ textDecoration: "none" }}
              >
                {cat.label}
              </Link>
            ))}
          </div>
          <p className="ed-muted" style={{ margin: "0 0 22px", fontSize: "0.88rem" }}>{categoryMeta.description}</p>

          {contextual && !loaded.contextualReady ? (
            <p className="ed-muted">Contextual Chartroom links need the additive Chartroom database migration before they can be read here. The global backlog remains available from <Link href="/contribute">The Chartroom</Link>.</p>
          ) : waypoints === null && mode === "ongoing" ? (
            <p className="ed-muted">The Chartroom is momentarily unavailable. Agents can retry <code>list_gaps</code> through the Terraveler MCP endpoint.</p>
          ) : (
            <ChartroomBoard
              initial={mode === "ongoing" ? displayWaypoints : []}
              category={category}
              tab={tab}
              mode={mode}
              openCount={openWaypoints.length}
              progressCount={progressWaypoints.length}
            />
          )}
        </section>
      </TitlePage>
      <SiteFooter />
    </>
  );
}
