import type { Voyage } from "./types";

/** Editorial context, approved with the Atlas entry rather than guessed from prose. */
export type VisualProfile = "mesoamerica" | "andes" | "marine-chart" | "mariner" | "unillustrated";

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

/** The curated, production-used page grounds. The log and the Specimen both
 * read this catalogue, so a new ground cannot quietly disappear from it. */
export const illuminationBackgrounds = {
  mesoamerica: {
    title: "Mesoamerican terrain",
    src: "/media/voyage-illumination/cortes-vertical.webp",
    alt: "A vertical engraved landscape of relief, paths and Mesoamerican motifs",
    context: "Mesoamerican land routes",
    use: "Fixed left margin · voyage log",
    caution: "Atmosphere, not a depiction of Tenochtitlan or a documented landfall.",
    example: { label: "Cortés · 1519", href: "/voyage/cortes-1519/log" },
    origin: "Terraveler original · generated 2026",
  },
  andes: {
    title: "Andean highlands",
    src: "/media/voyage-illumination/andes-vertical.webp",
    alt: "A vertical engraved landscape of Andean relief, river and terraces",
    context: "Andean highland routes",
    use: "Fixed left margin · voyage log",
    caution: "A regional motif, not an identified Inca site or stage of the journey.",
    example: { label: "Pizarro · 1532", href: "/voyage/pizarro-1532/log" },
    origin: "Terraveler original · generated 2026",
  },
  "marine-chart": {
    title: "Marine chart",
    src: "/media/voyage-illumination/marine-chart-vertical.webp",
    alt: "A vertical engraved chart with compass, coasts, islands and a vessel",
    context: "Seafaring and cartographic journeys",
    use: "Fixed left margin · voyage log",
    caution: "An imaginary chart, never a map of the voyage's verified route.",
    example: { label: "Cook · 1768", href: "/voyage/cook-1768/log" },
    origin: "Terraveler original · generated 2026",
  },
} as const;

export type PageComposition = keyof typeof illuminationBackgrounds;
export type IllustrationAssignment = {
  opener: IllustrationScene | null;
  pageComposition?: PageComposition;
  articleOrnament?: IllustrationScene;
};

/** Asset eligibility is declared once. Additional assets can be added to a
 * profile without touching individual articles. Nothing is chosen at random. */
export const visualAssets: Readonly<Record<Exclude<VisualProfile, "unillustrated">, {
  backgrounds: readonly PageComposition[];
  opener: IllustrationScene;
  articleOrnament: IllustrationScene;
}>> = {
  mesoamerica: { backgrounds: ["mesoamerica"], opener: "maya", articleOrnament: "maya" },
  andes: { backgrounds: ["andes"], opener: "andes", articleOrnament: "andes" },
  "marine-chart": { backgrounds: ["marine-chart"], opener: "astrolabe", articleOrnament: "coast" },
  mariner: { backgrounds: ["marine-chart"], opener: "navigator", articleOrnament: "ship" },
};

function stableIndex(slug: string, count: number): number {
  let hash = 0;
  for (const char of slug) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0) % count;
}

export function illustrationForVoyage(
  voyage: Pick<Voyage, "slug" | "kind" | "body">,
  profile: VisualProfile,
): IllustrationAssignment | null {
  if (voyage.kind === "space" || voyage.kind === "surface" ||
      (voyage.body && voyage.body !== "earth")) return null;
  if (profile === "unillustrated") return { opener: null };
  const asset = visualAssets[profile];
  return { opener: asset.opener,
    pageComposition: asset.backgrounds[stableIndex(voyage.slug, asset.backgrounds.length)],
    articleOrnament: asset.articleOrnament };
}
