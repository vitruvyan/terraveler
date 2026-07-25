/**
 * The place gazetteer: which real place each landfall is.
 *
 * Voyages carried free-text names, so the same island appeared as many
 * unrelated strings — Bougainville's "Taïti (New Cythera)" and Cook's "King
 * George's Island" are one landfall, and nothing in the atlas knew it. Each
 * entry ties a Wikidata entity to the stops that called there, with the
 * distance from the position each voyage recorded as the evidence for the
 * identification and a confidence to match (Carta §3.3).
 *
 * Built by scripts/build_gazetteer.py; server-side only, like the search index.
 */

import gazetteerData from "@/data/gazetteer.json";

export interface Visit {
  voyage: string;
  seq: number;
  called_it: string | null;
  distance_km: number;
  confidence: string;
}

export interface Place {
  qid: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  instance_of: string[];
  /** Names Wikidata knows it by. */
  aliases: string[];
  /** Names the voyages themselves used — the ones a reader is likely to type. */
  names_in_the_atlas: string[];
  visits: Visit[];
  voyages: string[];
  source_url: string;
}

const PLACES: Place[] = (gazetteerData as any).places ?? [];

/** Indexed by "<voyage>:<seq>" — the join back to a waypoint. */
const BY_STOP = new Map<string, Place>();
for (const p of PLACES) {
  for (const v of p.visits) BY_STOP.set(`${v.voyage}:${v.seq}`, p);
}

export function allPlaces(): Place[] {
  return PLACES;
}

export function placeForStop(voyage: string, seq: number): Place | undefined {
  return BY_STOP.get(`${voyage}:${seq}`);
}

/** Every other voyage that called at the same place — the cross-links that
 *  turn a shelf of separate voyages into an atlas. */
export function alsoVisited(voyage: string, seq: number): { place: Place; visits: Visit[] } | null {
  const place = placeForStop(voyage, seq);
  if (!place) return null;
  const others = place.visits.filter((v) => v.voyage !== voyage);
  return others.length ? { place, visits: others } : null;
}

/** Every name a place answers to, for search: its canonical name, Wikidata's
 *  aliases, and the names the voyages used. This is what lets "Otaheite" or
 *  "King George's Island" find Tahiti. */
export function searchNames(p: Place): string[] {
  return [p.name, ...p.aliases, ...p.names_in_the_atlas];
}
