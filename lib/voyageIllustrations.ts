import type { Voyage } from "./types";
import { isVoyageSlug, type VoyageSlug } from "./voyages";

/** Coordinates identify motifs on the original, unchanged HQ sheets. */
export const illustrationScenes = {
  ship: { sheet: "atlas-cartography", column: 2, row: 0 },
  coast: { sheet: "atlas-cartography", column: 1, row: 0 },
  astrolabe: { sheet: "atlas-cartography", column: 0, row: 1 },
  navigator: { sheet: "mariners", column: 1, row: 1 },
  captain: { sheet: "mariners", column: 0, row: 1 },
  sailor: { sheet: "mariners", column: 1, row: 0 },
  maya: { sheet: "new-worlds", column: 0, row: 0 },
  andes: { sheet: "new-worlds", column: 0, row: 1 },
} as const;

export type IllustrationScene = keyof typeof illustrationScenes;
export type PageComposition = "mesoamerica" | "andes";
type Assignment = { opener: IllustrationScene | null; pageComposition?: PageComposition };

// A null is deliberate: an unrelated image would mislead even as an ornament.
const assignments: Record<VoyageSlug, Assignment> = {
  "boudeuse-1766": { opener: "ship" },
  "boussole-1785": { opener: "navigator" },
  "cook-1768": { opener: "astrolabe" },
  "cortes-1519": { opener: "maya", pageComposition: "mesoamerica" }, // Regional context, not a particular landfall.
  "voyager-2": { opener: null },
  "apollo-11": { opener: null },
  "darwin-1831": { opener: null },
  "magellan-1519": { opener: "sailor" },
  "pizarro-1532": { opener: "andes", pageComposition: "andes" },
  "columbus-1492": { opener: "ship" },
  "shackleton-1914": { opener: null },
  "xuanzang-629": { opener: null },
  "cartier-1534": { opener: "coast" },
  "dias-1487": { opener: "coast" },
  "gama-1497": { opener: "astrolabe" },
  "drake-1577": { opener: "captain" },
  "leoafricanus-1510": { opener: null },
  "faxian-399": { opener: null },
  "polo-1271": { opener: null },
  "lewisclark-1804": { opener: null },
  "mungopark-1795": { opener: null },
  "ibnbattuta-1325": { opener: null },
  "cabot-1497": { opener: "ship" },
};

export function illustrationForVoyage(voyage: Pick<Voyage, "slug" | "kind" | "body">): Assignment | null {
  if (voyage.kind === "space" || voyage.kind === "surface" || (voyage.body && voyage.body !== "earth")) return null;
  return isVoyageSlug(voyage.slug) ? assignments[voyage.slug] : null;
}
