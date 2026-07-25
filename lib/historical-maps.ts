/**
 * Historical political basemaps, one per era.
 *
 * A voyage is drawn over the reconstruction nearest to it in time, not over a
 * single fixed year: showing Cortés's 1519 campaign on 1715 colonial borders
 * was two centuries wrong. `epochFor()` picks by date and the UI states which
 * year is on screen, so the reader can judge the distance for themselves.
 *
 * The polygons are upstream data, unmodified except for coordinate rounding
 * (see scripts/fetch-basemaps.md). Which entity counts as a "great power" is a
 * (contestable) editorial call, so it lives here in code — reviewable and
 * versioned — rather than baked into the geojson as an opaque field.
 *
 * Source: aourednik/historical-basemaps, CC BY-SA 4.0.
 */

export interface GreatPower {
  label: string;
  color: string;
  /** Exact SUBJECTO/NAME values in that era's file. Both fields are matched:
   *  a colony carries its metropole in SUBJECTO ("Cuba (Spain)" → "Spain"),
   *  while a metropole or an unsubjected power matches on its own NAME. */
  match: string[];
}

export interface HistoricalEpoch {
  year: number;
  /** Public path of the bundled geojson. */
  file: string;
  /** Colour key for the Cartographer lens, in legend order. */
  powers: GreatPower[];
  /** One line for the Cartographer panel — what this era's map shows. */
  blurb: string;
}

const C = {
  british: "#b04a3c",
  french: "#3f5f9a",
  spanish: "#d0a23f",
  portuguese: "#3f8a5a",
  dutch: "#e07a2e",
  habsburg: "#b3a13f",
  russian: "#7d5a9a",
  chinese: "#c2653a",
  indian: "#a24a6e",
  persian: "#3f9090",
  ottoman: "#6b8f3f",
  japanese: "#9a4560",
  american: "#8a6b4a",
  amerindian: "#8a7a3f",
} as const;

export const OTHER_COLOR = "#d9caa4";

/**
 * Available reconstructions, ascending. Adding an era is: fetch and round the
 * upstream file into public/, then add an entry here with that era's powers —
 * the map, the legend and the labels all follow from this list.
 */
export const EPOCHS: HistoricalEpoch[] = [
  {
    year: 1530,
    file: "/world_1530.geojson",
    blurb:
      "The world as the first conquests found it: Iberian crowns spreading across the Atlantic, the Ottomans at their height, Ming China and the Inca still sovereign.",
    powers: [
      { label: "Spanish", color: C.spanish, match: ["Spain", "Vice Royalty of New Spain", "Cuba (Spain)", "Hispaniola (Spain)"] },
      { label: "Portuguese", color: C.portuguese, match: ["Portugal"] },
      { label: "Holy Roman Empire", color: C.habsburg, match: ["Holy Roman Empire"] },
      { label: "France", color: C.french, match: ["France"] },
      { label: "England", color: C.british, match: ["England and Ireland"] },
      { label: "Ottoman", color: C.ottoman, match: ["Ottoman Empire"] },
      { label: "Safavid (Persia)", color: C.persian, match: ["Safavid Empire"] },
      { label: "Mughal", color: C.indian, match: ["Mughal Empire"] },
      { label: "Ming China", color: C.chinese, match: ["Ming Chinese Empire"] },
      { label: "Muscovy", color: C.russian, match: ["Tsardom of Muscovy"] },
      { label: "Inca", color: C.amerindian, match: ["Inca Empire"] },
    ],
  },
  {
    year: 1715,
    file: "/world_1715.geojson",
    blurb:
      "The colonial world at its mid-imperial settlement: five European crowns holding overseas empires, four land empires across Asia.",
    powers: [
      // "Neterlands" is a misspelling present in the upstream data.
      { label: "British", color: C.british, match: ["United Kingdom"] },
      { label: "French", color: C.french, match: ["France"] },
      { label: "Spanish", color: C.spanish, match: ["Spain"] },
      { label: "Portuguese", color: C.portuguese, match: ["Portugal", "Portuguese Guinea", "Portuguese East Africa"] },
      { label: "Dutch", color: C.dutch, match: ["Netherlands", "Neterlands", "Dutch Republic", "Netherlands Antilles"] },
      { label: "Habsburg (Austria)", color: C.habsburg, match: ["Austrian Empire"] },
      { label: "Russian (Muscovy)", color: C.russian, match: ["Tsardom of Muscovy"] },
      { label: "Qing (Manchu)", color: C.chinese, match: ["Manchu Empire"] },
      { label: "Mughal", color: C.indian, match: ["Mughal Empire"] },
      { label: "Safavid (Persia)", color: C.persian, match: ["Safavid Empire"] },
      { label: "Ottoman", color: C.ottoman, match: ["Ottoman Empire", "Algiers", "Tunis", "Egypt"] },
      { label: "Japan (Tokugawa)", color: C.japanese, match: ["Tokugawa shogunate"] },
    ],
  },
  {
    year: 1783,
    file: "/world_1783.geojson",
    blurb:
      "The world of the Pacific voyages: Britain and France charting what Spain and Portugal had claimed, Russia reaching the Pacific — and a new republic on the Atlantic seaboard.",
    powers: [
      { label: "British", color: C.british, match: ["UK", "United Kingdom", "Rupert's Land", "British East India Company"] },
      { label: "French", color: C.french, match: ["France"] },
      { label: "Spanish", color: C.spanish, match: ["Spain"] },
      { label: "Portuguese", color: C.portuguese, match: ["Portugal"] },
      { label: "Dutch", color: C.dutch, match: ["Netherlands", "Dutch East Indies", "Dutch settlements", "Ceylon (Dutch)"] },
      { label: "Austria", color: C.habsburg, match: ["Austria", "Austrian Empire", "Austrian Netherlands"] },
      { label: "Russian", color: C.russian, match: ["Russian Empire"] },
      { label: "Qing China", color: C.chinese, match: ["Qing Empire"] },
      { label: "Maratha", color: C.indian, match: ["Maratha Confederacy"] },
      { label: "Persia", color: C.persian, match: ["Persia"] },
      { label: "Ottoman", color: C.ottoman, match: ["Ottoman Empire"] },
      { label: "Japan", color: C.japanese, match: ["Japan"] },
      { label: "United States", color: C.american, match: ["United States of America"] },
    ],
  },
];

/** Reconstruction nearest in time to a voyage. Falls back to the middle of the
 *  list when a voyage carries no usable start date. */
export function epochFor(startDate?: string | null): HistoricalEpoch {
  const year = Number(String(startDate ?? "").slice(0, 4));
  if (!Number.isFinite(year) || year === 0) return EPOCHS[Math.floor(EPOCHS.length / 2)];
  return EPOCHS.reduce((best, e) =>
    Math.abs(e.year - year) < Math.abs(best.year - year) ? e : best
  );
}

/**
 * MapLibre paint expression colouring each polygon by its era's great powers.
 * Matches SUBJECTO first (a colony names its metropole there), falling back to
 * NAME for metropoles and unsubjected powers; anything unmatched stays neutral,
 * which is most of the globe and deliberately so.
 */
export function empireColorExpression(epoch: HistoricalEpoch): unknown[] {
  const pairs = (get: string) => {
    const expr: unknown[] = ["match", ["get", get]];
    for (const p of epoch.powers) expr.push(p.match, p.color);
    return expr;
  };
  const byName = pairs("NAME");
  byName.push(OTHER_COLOR);
  const bySubject = pairs("SUBJECTO");
  bySubject.push(byName); // fall through to NAME when SUBJECTO doesn't match
  return bySubject;
}
