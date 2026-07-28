import { NextResponse } from "next/server";
import { ATLAS, isVoyageSlug, voyageLogPath } from "@/lib/voyages";
import { getVoyageBundle } from "@/lib/data";
import { allPlaces } from "@/lib/gazetteer";
import { searchIndex, rank, normalize as norm } from "@/lib/search-index";
import { evidenceBasisOf, evidenceCopy } from "@/lib/evidence";

/**
 * The atlas over plain GET, for assistants that can fetch a URL and nothing more.
 *
 * MCP is POST-only. So is the raw JSON-RPC fallback that skill.md offers as the
 * way in for clients without connector support. An assistant whose only web
 * capability is "open this URL" — which is most of them, and which Kimi
 * described exactly — could therefore read our documentation and never reach a
 * single voyage. The Carta says the Curator judges the work and not the model;
 * that promise was quietly conditional on the model being able to POST.
 *
 * One route, dispatched by query parameter, so a model can be handed a single
 * address and discover the rest. Calling it bare returns a description of
 * itself: an assistant that fetches it once knows the whole surface.
 *
 * Reading only. Contributing still goes through MCP or JSON-RPC, because a
 * write needs a key and a key needs a POST — and a GET that mutated anything
 * would be a worse idea than the problem it solved.
 */
export const runtime = "nodejs";
export const revalidate = 300;

const SITE = "https://www.terraveler.com";
const CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": CACHE, "Access-Control-Allow-Origin": "*" },
  });
}

/** The self-description. Deliberately the response to a bare GET: the first
 *  thing a curious model does with a URL is fetch it with nothing attached. */
function index() {
  return json({
    atlas: "Terraveler — a curated atlas of geo-history",
    what_this_is:
      "Voyages told stage by stage, with the traveller's own words quoted verbatim " +
      "and cited. Every voyage declares what kind of record it survives through, and " +
      "where the evidence was destroyed it says so rather than guessing.",
    how_to_use_this_endpoint: {
      search: `${SITE}/api/atlas?q=tahiti`,
      one_voyage: `${SITE}/api/atlas?voyage=cook-1768`,
      one_place: `${SITE}/api/atlas?place=Tahiti`,
    },
    note:
      "GET only, no key, no account. This exists because MCP and JSON-RPC both " +
      "require POST, and an assistant that can only open a URL was unable to read " +
      "the atlas at all.",
    voyages: ATLAS.map((v) => ({
      slug: v.slug, title: v.title, navigator: v.navigator, years: v.years,
      url: `${SITE}${voyageLogPath(v.slug)}`,
    })),
    contributing:
      `Reading is free. Writing is verified first and needs POST — see ${SITE}/skill.md ` +
      `for the JSON-RPC calls, or ${SITE}/connect to wire up an MCP client.`,
    licence: "CC BY-SA 4.0; underlying sources keep their own open licences",
  });
}

async function search(q: string, limit: number) {
  const hits = rank(await searchIndex(), q, limit);
  if (!hits.length) {
    return json({
      query: q, found: 0,
      note:
        "The atlas holds nothing for this. That is a real answer rather than a failure — " +
        "Terraveler says what it does not have.",
      suggest: `${SITE}/contribute`,
    });
  }
  return json({
    query: q, found: hits.length,
    results: hits.map((h) => ({
      type: h.type, label: h.label, context: h.sublabel,
      url: `${SITE}${h.href}`, voyage: h.voyage ?? undefined,
    })),
  });
}

async function voyage(slug: string) {
  if (!isVoyageSlug(slug))
    return json({ error: `unknown voyage '${slug}'`, known: ATLAS.map((v) => v.slug) }, 404);
  const { voyage: v, navigator, waypoints } = await getVoyageBundle(slug);
  const basis = evidenceBasisOf(v);
  return json({
    slug, title: v.title, navigator: navigator.name,
    ships: v.ships ?? undefined, sponsor: v.sponsor ?? undefined,
    years: [v.start_date, v.end_date].filter(Boolean).join("–"),
    summary: v.summary,
    evidence_basis: basis ? { tier: basis, means: evidenceCopy(basis).blurb } : null,
    what_was_lost: v.what_was_lost ?? null,
    url: `${SITE}${voyageLogPath(slug)}`,
    stages: (waypoints as any[]).map((w) => ({
      seq: w.seq,
      place: w.place_historical ?? w.body,
      today: w.place_modern ?? undefined,
      arrived: w.arrival_date ?? undefined,
      confidence: w.confidence,
      event: w.event ?? undefined,
      // Verbatim or absent. A stage with nothing verified says so.
      excerpt: w.diary_excerpt ?? null,
      source: w.diary_excerpt
        ? { citation: w.diary_source_citation, url: w.diary_source_url }
        : undefined,
    })),
  });
}

async function place(query: string) {
  const q = norm(query);
  const names = (p: any) =>
    [p.name, ...(p.aliases ?? []), ...(p.names_in_the_atlas ?? [])].map((n: any) => norm(String(n)));
  const places = allPlaces();
  const hit = places.find((p) => names(p).includes(q))
           ?? places.find((p) => names(p).some((n) => n.includes(q)));
  if (!hit) return json({ query, found: 0, note: "No place in the atlas resolves to that." }, 404);

  const visited = await Promise.all(hit.visits.map(async (v) => {
    const entry = ATLAS.find((a) => a.slug === v.voyage);
    let excerpt: string | null = null, citation: string | null = null;
    try {
      const b = await getVoyageBundle(v.voyage);
      const w = (b.waypoints as any[]).find((x) => x.seq === v.seq);
      excerpt = w?.diary_excerpt ?? null;
      citation = w?.diary_source_citation ?? null;
    } catch { /* a gazetteer entry can outlive a bundle */ }
    return {
      voyage: v.voyage, navigator: entry?.navigator ?? v.voyage, years: entry?.years,
      called_it: v.called_it ?? undefined, stage: v.seq, confidence: v.confidence,
      excerpt, citation,
      url: `${SITE}${voyageLogPath(v.voyage)}#stage-${v.seq}`,
    };
  }));

  return json({
    place: hit.name,
    description: hit.description ?? undefined,
    coordinates: { latitude: hit.latitude, longitude: hit.longitude },
    also_known_as: [...new Set([...(hit.aliases ?? []), ...(hit.names_in_the_atlas ?? [])])].slice(0, 12),
    identified_as: hit.source_url,
    visited_by: visited.sort((a, b) => String(a.years).localeCompare(String(b.years))),
    note: visited.length > 1
      ? "These expeditions reached the same place, resolved by coordinate rather than by name."
      : "One recorded visit in the atlas so far.",
  });
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? p.get("search") ?? "").trim();
  const v = (p.get("voyage") ?? "").trim();
  const pl = (p.get("place") ?? "").trim();
  const limit = Math.min(Math.max(Number(p.get("limit")) || 12, 1), 40);

  if (v) return voyage(v);
  if (pl) return place(pl);
  if (q) return search(q, limit);
  return index();
}
