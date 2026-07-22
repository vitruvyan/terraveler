import type { VoyageKind } from "./types";

/**
 * Resolves which renderer a voyage uses. Explicit `render` wins; otherwise
 * derived from the legacy `kind` field so every voyage bundle written before
 * `render` existed (no field at all) keeps behaving exactly as before:
 * `kind:"space"` ⇒ the SVG orrery ("orbital"), anything else ⇒ MapLibre
 * ("earth"). `kind:"surface"` bundles that predate this field would also
 * fall through to "earth" here, which is why new surface voyages should set
 * `render:"surface"` explicitly (see data/apollo-11.json).
 */
export function resolveRender(v: {
  render?: string;
  kind?: string;
}): "earth" | "surface" | "orbital" {
  return (v.render as any) ?? (v.kind === "space" ? "orbital" : "earth");
}

/** The atlas index — one entry per published voyage. Used by the map's
 *  voyage picker, the cartouche, and the /voyages page. */
export interface AtlasEntry {
  slug: string;
  href: string;
  title: string;
  navigator: string;
  years: string;
  blurb: string;
  /** Omitted means "earth" — see VoyageKind. Drives the Atlas panel's chips. */
  kind?: VoyageKind;
}

export const ATLAS: AtlasEntry[] = [
  {
    slug: "boudeuse-1766",
    href: "/",
    title: "The First French Circumnavigation of the Globe",
    navigator: "Louis-Antoine de Bougainville",
    years: "1766–1769",
    blurb:
      "Around the world for France: fifty-two days in Magellan's strait, Tahiti named New Cythera, hunger in the Louisiades — and home with only seven men lost.",
  },
  {
    slug: "boussole-1785",
    href: "/voyage/boussole-1785",
    title: "The Voyage of La Pérouse",
    navigator: "Jean-François de Galaup, comte de La Pérouse",
    years: "1785–1788",
    blurb:
      "France's answer to Cook: Alaska to Kamchatka to Botany Bay — then silence, and the secret of the sea solved at Vanikoro forty years on.",
  },
  {
    slug: "cook-1768",
    href: "/voyage/cook-1768",
    title: "The First Voyage of Captain Cook",
    navigator: "Lieutenant James Cook",
    years: "1768–1771",
    blurb:
      "The Endeavour to Tahiti for the Transit of Venus, then south under sealed orders: the charting of New Zealand and the east coast of New Holland — the first voyage auto-extracted by Terraveler from Cook's own journal.",
  },
  {
    slug: "voyager-2",
    href: "/voyage/voyager-2",
    title: "Voyager 2: The Grand Tour of the Giant Planets",
    navigator: "Voyager 2 (NASA / JPL)",
    years: "1977–",
    blurb:
      "The only probe to fly all four giant planets: Jupiter, Saturn, Uranus, Neptune — then on past the heliopause into interstellar space, still transmitting.",
    kind: "space",
  },
  {
    slug: "apollo-11",
    href: "/voyage/apollo-11",
    title: "Apollo 11: The First Moonwalk",
    navigator: "Apollo 11 (NASA)",
    years: "1969",
    blurb:
      "Two and a half hours on the Sea of Tranquility: the Eagle's landing, the first bootprint, the flag, the seismometer left running, and a walk out to Little West Crater before the climb back up the ladder.",
    kind: "surface",
  },
];
