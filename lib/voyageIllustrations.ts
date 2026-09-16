import type { Voyage } from "./types";
import { isVoyageSlug, type VoyageSlug } from "./voyages";

/** Original editorial composites, not likenesses, historical views or waypoint evidence.
 * The coordinates select one cell of an HQ specimen sheet without altering it. */
export const illustrationScenes = {
  ship: { sheet: "atlas-cartography", column: 2, row: 0, label: "A ship under sail", context: "A maritime chapter opener; an imagined vessel, not this expedition's ship." },
  coast: { sheet: "atlas-cartography", column: 1, row: 0, label: "Coasts and islands", context: "A cartographic threshold, not a chart of this landfall." },
  astrolabe: { sheet: "atlas-cartography", column: 0, row: 1, label: "The astrolabe", context: "An instrument of navigation, not an object recorded on this voyage." },
  navigator: { sheet: "mariners", column: 1, row: 1, label: "The navigator", context: "An imagined role, not a portrait of the traveller." },
  captain: { sheet: "mariners", column: 0, row: 1, label: "The captain", context: "An imagined command role, not a portrait of the traveller." },
  sailor: { sheet: "mariners", column: 1, row: 0, label: "The sailor", context: "The labour of a sea passage; an imagined figure, not a crew record." },
  conquistador: { sheet: "mariners", column: 0, row: 0, label: "The conquistador", context: "An imagined colonial role, not a portrait of Cortés." },
  maya: { sheet: "new-worlds", column: 0, row: 0, label: "A Maya city", context: "A regional editorial imaginary for the Cozumel encounter; not a view of Cozumel or Tenochtitlan." },
  andes: { sheet: "new-worlds", column: 0, row: 1, label: "Andean realms", context: "An imagined Andean landscape, not a view of Cajamarca or Cusco." },
} as const;

export type IllustrationScene = keyof typeof illustrationScenes;
type Assignment = { opener: IllustrationScene | null; encounter?: { stage: number; scene: IllustrationScene } };

// A null is an editorial decision: no available sheet portrays these journeys
// faithfully. Never substitute a Maya city for the Andes, or a sail for Asia.
const assignments: Record<VoyageSlug, Assignment> = {
  "boudeuse-1766": { opener: "ship" },
  "boussole-1785": { opener: "navigator" },
  "cook-1768": { opener: "astrolabe" },
  "cortes-1519": { opener: "conquistador", encounter: { stage: 2, scene: "maya" } },
  "voyager-2": { opener: null },
  "apollo-11": { opener: null },
  "darwin-1831": { opener: null },
  "magellan-1519": { opener: "sailor" },
  "pizarro-1532": { opener: "andes" },
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
