/**
 * The atlas search index — built on the server, queried over HTTP.
 *
 * Deliberately never shipped to the browser: six voyages carry ~100
 * waypoints, so a thousand would carry ~16,000 entries, and a client-side
 * filter over a bundled array (which is what the voyage picker used to do)
 * stops being viable long before that. Searching server-side keeps the
 * client's cost flat as the atlas grows, and the /api/search contract is the
 * same one a Postgres full-text backend would serve, so the swap — when the
 * index outgrows the bundled JSON — is behind this file, not in the UI.
 */

import { ATLAS } from "./voyages";
import { getVoyageBundle } from "./data";
import { voyageLogPath, voyagePath } from "./voyages";
import type { SpaceWaypoint, Waypoint } from "./types";

export type EntryType = "voyage" | "navigator" | "place";

export interface IndexEntry {
  type: EntryType;
  /** What the reader sees. */
  label: string;
  /** Context under the label: the voyage a place belongs to, a navigator's dates. */
  sublabel: string;
  href: string;
  /** Lowercased, accent-stripped haystack. */
  key: string;
  /** Ties a place back to its voyage, for grouping. */
  voyage?: string;
}

/** Accent-insensitive so "Perouse" finds "Pérouse" and "Tenochtitlan"
 *  finds "Tenochtitlán" — the atlas is full of names readers can't type. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

let cached: IndexEntry[] | null = null;
let cachedEras: string[] | null = null;

export async function searchIndex(): Promise<IndexEntry[]> {
  if (cached) return cached;
  const entries: IndexEntry[] = [];
  const eras: string[] = [];
  const seenPlace = new Set<string>();

  for (const v of ATLAS) {
    const { navigator, voyage, waypoints } = await getVoyageBundle(v.slug);
    const mapHref = voyagePath(v.slug);

    const century = (d?: string | null) => {
      const y = Number(String(d ?? "").slice(0, 4));
      return Number.isFinite(y) && y ? `${Math.floor(y / 100) + 1}th century` : null;
    };
    const era = century(voyage.start_date);

    entries.push({
      type: "voyage",
      label: v.title,
      sublabel: `${v.navigator} · ${v.years}`,
      href: mapHref,
      // The era is part of the voyage's haystack, not a result of its own:
      // searching "18th century" should return that century's voyages, not
      // three identical rows saying "18th century".
      key: normalize(`${v.title} ${v.navigator} ${v.years} ${v.blurb} ${voyage.ships ?? ""} ${era ?? ""}`),
      voyage: v.slug,
    });

    entries.push({
      type: "navigator",
      label: navigator.name,
      sublabel: [
        navigator.nationality,
        navigator.birth_year ? `${navigator.birth_year}–${navigator.death_year ?? ""}` : "",
      ].filter(Boolean).join(" · "),
      href: mapHref,
      key: normalize(`${navigator.name} ${navigator.nationality ?? ""}`),
      voyage: v.slug,
    });

    // Kept out of the ranked results (see above) and used only to build the
    // browse facets, which is where an era is actually useful.
    if (era) eras.push(era);

    for (const w of waypoints as (Waypoint | SpaceWaypoint)[]) {
      const anyW = w as any;
      const name: string = anyW.place_historical || anyW.place_modern || anyW.event || "";
      if (!name) continue;
      const dedupe = `${v.slug}:${normalize(name)}`;
      if (seenPlace.has(dedupe)) continue;
      seenPlace.add(dedupe);
      entries.push({
        type: "place",
        label: name,
        sublabel: `${v.title}${anyW.arrival_date ? ` · ${String(anyW.arrival_date).slice(0, 4)}` : ""}`,
        href: `${voyageLogPath(v.slug)}#wp-${w.seq}`,
        key: normalize(
          [name, anyW.place_modern, anyW.event, anyW.arrival_date, v.navigator].filter(Boolean).join(" ")
        ),
        voyage: v.slug,
      });
    }
  }

  cached = entries;
  cachedEras = eras;
  return entries;
}

export interface SearchHit extends IndexEntry {
  score: number;
}

/** Prefix and word-boundary matches outrank mid-word ones, so typing "tah"
 *  puts Tahiti first rather than whatever merely contains those letters. */
export function rank(entries: IndexEntry[], q: string, limit = 24): SearchHit[] {
  const nq = normalize(q);
  if (!nq) return [];
  const TYPE_BONUS: Record<EntryType, number> = { voyage: 3, navigator: 2, place: 1 };
  const hits: SearchHit[] = [];
  for (const e of entries) {
    const at = e.key.indexOf(nq);
    if (at < 0) continue;
    const labelAt = normalize(e.label).indexOf(nq);
    let score = 0;
    if (labelAt === 0) score += 100;           // label starts with the query
    else if (labelAt > 0) score += 60;         // appears in the label
    if (at === 0 || e.key[at - 1] === " ") score += 25;  // word boundary
    score += Math.max(0, 20 - at / 4);         // earlier is better
    score += TYPE_BONUS[e.type];
    hits.push({ ...e, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.label.length - b.label.length).slice(0, limit);
}

/** Browsable facets for the empty query: what the atlas actually holds, which
 *  grows with it — the replacement for a hand-listed handful of voyages. */
export async function topics(): Promise<{ label: string; count: number; href: string }[]> {
  await searchIndex();
  const byEra = new Map<string, number>();
  for (const era of cachedEras ?? []) byEra.set(era, (byEra.get(era) ?? 0) + 1);
  return [...byEra.entries()]
    .map(([label, count]) => ({ label, count, href: `/search?q=${encodeURIComponent(label)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
