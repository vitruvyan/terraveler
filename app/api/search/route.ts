import { NextResponse } from "next/server";
import { rank, searchIndex, topics, type EntryType } from "@/lib/search-index";
import { ATLAS, voyagePath } from "@/lib/voyages";
import { POSTGREST_SERVICE_KEY, POSTGREST_URL } from "@/lib/backendConfig";

export const runtime = "nodejs";

/**
 * Cached at the edge, with one deliberate exception.
 *
 * A search result is a pure function of the atlas's content, so the same query
 * need not wake a lambda for every reader: Vercel's CDN can answer it, and
 * `stale-while-revalidate` means even an expired entry is served instantly
 * while it refreshes behind the reader's back — which is both faster and more
 * resilient than any cache we could run ourselves.
 *
 * The exception is a query that found nothing: that response carries a side
 * effect (it records what the atlas was asked for and lacked), and caching it
 * would silence exactly the signal the editorial roadmap is meant to hear. So
 * hits are cached and misses are not — see below.
 */
const CACHE_HIT = "public, s-maxage=600, stale-while-revalidate=86400";
const CACHE_MISS = "no-store";

/** A query that found nothing is a request the atlas can't yet answer, so it
 *  is worth recording — but it is also unauthenticated free text that an
 *  editor will read, so only plausible topic-shaped queries are kept: letters,
 *  spaces and ordinary punctuation, nothing that could pass for markup, a URL
 *  or an instruction. Failure is silent: search must not break because the
 *  demand log is unavailable. */
const TOPIC_SHAPE = /^[\p{L}\p{N} .,'’()-]{3,80}$/u;

async function recordMiss(q: string): Promise<void> {
  if (!POSTGREST_URL || !POSTGREST_SERVICE_KEY || !TOPIC_SHAPE.test(q)) return;
  try {
    await fetch(`${POSTGREST_URL}/rest/v1/rpc/record_search_miss`, {
      method: "POST",
      headers: {
        apikey: POSTGREST_SERVICE_KEY,
        Authorization: `Bearer ${POSTGREST_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: q.trim().slice(0, 80) }),
    });
  } catch {
    /* the demand log is best-effort — never fail a search over it */
  }
}

const ORDER: EntryType[] = ["voyage", "navigator", "place"];
const GROUP_LABEL: Record<EntryType, string> = {
  voyage: "Voyages",
  navigator: "Navigators",
  place: "Places & landfalls",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 120);
  const kind = url.searchParams.get("kind") ?? "";
  const exclude = url.searchParams.get("exclude") ?? "";
  const idx = await searchIndex();

  if (!q.trim()) {
    const all = ATLAS.filter((v) => (v.kind ?? "earth") === (kind || "earth"));
    return NextResponse.json({
      q: "",
      groups: [],
      total: 0,
      topics: await topics(),
      counts: {
        voyages: idx.filter((e) => e.type === "voyage").length,
        places: idx.filter((e) => e.type === "place").length,
        kind: all.length,
      },
      featured: all
        .filter((v) => v.slug !== exclude)
        .slice(0, 5)
        .map((v) => ({
          type: "voyage",
          label: v.title,
          sublabel: `${v.navigator} · ${v.years}`,
          href: voyagePath(v.slug),
        })),
    }, { headers: { "Cache-Control": CACHE_HIT } });
  }

  const hits = rank(idx, q);
  const groups = ORDER.map((type) => {
    const own = hits.filter((h) => h.type === type);
    return {
      type,
      label: GROUP_LABEL[type],
      best: own[0]?.score ?? 0,
      items: own.slice(0, 6).map(({ score, key, ...rest }) => rest),
    };
  })
    .filter((g) => g.items.length > 0)
    .sort((a, b) => b.best - a.best)
    .map(({ best, ...g }) => g);

  if (hits.length === 0 && url.searchParams.get("record") === "1") await recordMiss(q);

  return NextResponse.json({
    q,
    groups,
    total: hits.length,
    missing: hits.length === 0 ? { query: q.trim() } : null,
  }, {
    headers: { "Cache-Control": hits.length ? CACHE_HIT : CACHE_MISS },
  });
}
