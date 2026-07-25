import { NextResponse } from "next/server";
import { rank, searchIndex, topics, type EntryType } from "@/lib/search-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_URL = (process.env.SUPABASE_URL ?? "").replace(/[\s​-‍﻿]+/g, "").replace(/\/+$/, "");
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY ?? "").replace(/[\s​-‍﻿]+/g, "").replace(/\/+$/, "");

/** A query that found nothing is a request the atlas can't yet answer, so it
 *  is worth recording — but it is also unauthenticated free text that an
 *  editor will read, so only plausible topic-shaped queries are kept: letters,
 *  spaces and ordinary punctuation, nothing that could pass for markup, a URL
 *  or an instruction. Failure is silent: search must not break because the
 *  demand log is unavailable. */
const TOPIC_SHAPE = /^[\p{L}\p{N} .,'’()-]{3,80}$/u;

async function recordMiss(q: string): Promise<void> {
  if (!SB_URL || !SB_KEY || !TOPIC_SHAPE.test(q)) return;
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/record_search_miss`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
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
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
  const idx = await searchIndex();

  // Empty query: hand back what the atlas holds, so the reader can browse
  // rather than guess. This is what scales past a hand-written shortlist.
  if (!q.trim()) {
    return NextResponse.json({
      q: "",
      groups: [],
      total: 0,
      topics: await topics(),
      counts: {
        voyages: idx.filter((e) => e.type === "voyage").length,
        places: idx.filter((e) => e.type === "place").length,
      },
    });
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
    // Strongest group first: searching a person's name should lead with the
    // person, even though voyages usually outrank places.
    .sort((a, b) => b.best - a.best)
    .map(({ best, ...g }) => g);

  if (hits.length === 0) await recordMiss(q);

  return NextResponse.json({
    q,
    groups,
    total: hits.length,
    // The dead end becomes the contribution funnel: nothing here yet, but the
    // atlas grows by exactly this route.
    missing: hits.length === 0 ? { query: q.trim() } : null,
  });
}
