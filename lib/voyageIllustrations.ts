import type { Voyage } from "./types";
import { isVoyageSlug, type VoyageSlug } from "./voyages";

/** Editorial decoration, never a plate or evidence for a particular landfall.
 * Keep the classification on the voyage, so both views of its log agree. */
export type VoyageIllustration = "sea" | "conquest" | "americas" | "land";

// Exhaustive against the published atlas: a new voyage needs an editorial
// decision before an image can silently imply a culture or mode of travel.
const themes = {
  "boudeuse-1766": "sea",
  "boussole-1785": "sea",
  "cook-1768": "sea",
  "cortes-1519": "conquest",
  "voyager-2": null,
  "apollo-11": null,
  "darwin-1831": "sea",
  "magellan-1519": "sea",
  "pizarro-1532": "conquest",
  "columbus-1492": "americas",
  "shackleton-1914": "sea",
  "xuanzang-629": "land",
  "cartier-1534": "sea",
  "dias-1487": "sea",
  "gama-1497": "sea",
  "drake-1577": "sea",
  "leoafricanus-1510": "land",
  "faxian-399": "land",
  "polo-1271": "land",
  "lewisclark-1804": "land",
  "mungopark-1795": "land",
  "ibnbattuta-1325": "land",
  "cabot-1497": "sea",
} satisfies Record<VoyageSlug, VoyageIllustration | null>;

export function illustrationForVoyage(voyage: Pick<Voyage, "slug" | "kind" | "body">): VoyageIllustration | null {
  if (voyage.kind === "space" || voyage.kind === "surface" || (voyage.body && voyage.body !== "earth")) return null;
  return isVoyageSlug(voyage.slug) ? themes[voyage.slug] : null;
}
