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

/** `as const satisfies` (not a plain annotation) so each slug keeps its
 *  literal type: VoyageSlug below is derived from it, and lib/data.ts keys
 *  its bundle registry by that type — so a voyage added to one place and
 *  forgotten in the other fails the build instead of shipping half-visible.
 *  Consumers read the widened ATLAS export below, which keeps `kind` optional
 *  as before. */
const ATLAS_ENTRIES = [
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
    slug: "cortes-1519",
    href: "/voyage/cortes-1519",
    title: "The Conquest of Mexico by Hernán Cortés",
    navigator: "Hernán Cortés",
    years: "1519–1521",
    blurb:
      "From the Veracruz sands to the causeways of Tenochtitlan: the alliance with Tlaxcala, the massacre at Cholula, the seizure of Moctezuma, the flight of the Noche Triste, and the siege that ended the Aztec empire — extracted from Bernal Díaz's eyewitness memoir.",
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
  {
    slug: "darwin-1831",
    href: "/voyage/darwin-1831",
    title: "The Second Voyage of HMS Beagle (1831-1836)",
    navigator: "Charles Darwin",
    years: "1831–1836",
    blurb:
      "A survey of South America that turned into something else: the fossil beds of Patagonia, the earthquake at Concepci\u00f3n, the Gal\u00e1pagos, and the coral atolls of the Keeling Islands.",
  },
  {
    slug: "magellan-1519",
    href: "/voyage/magellan-1519",
    title: "The First Circumnavigation: Magellan and Elcano (1519-1522)",
    navigator: "Ferdinand Magellan",
    years: "1519–1522",
    blurb:
      "The first voyage to circle the world: the strait that took Magellan's name, ninety-eight days of open Pacific on rotten stores, his death at Mactan, and one ship of five coming home under Elcano.",
  },
  {
    slug: "pizarro-1532",
    href: "/voyage/pizarro-1532",
    title: "Pizarro and the Fall of Tawantinsuyu (1532-1533)",
    navigator: "Francisco Pizarro",
    years: "1532–1533",
    blurb:
      "Xerez was Pizarro's own secretary and stood in the square at Cajamarca. The march from Tumbez, the ambush, the room filled with the gold of Cusco, and a conquest recorded by the men who made it.",
  },
  {
    slug: "columbus-1492",
    href: "/voyage/columbus-1492",
    title: "The Voyages of Christopher Columbus (1492-1504)",
    navigator: "Christopher Columbus",
    years: "1492–1504",
    blurb:
      "The crossing of 1492 and the voyages that followed \u2014 reaching us not through Columbus's lost log but through Las Casas's abstract of it, quoting in places and summarising in others.",
  },
  {
    slug: "shackleton-1914",
    href: "/voyage/shackleton-1914",
    title: "The Imperial Trans-Antarctic Expedition (1914-1917)",
    navigator: "Ernest Shackleton",
    years: "1914–1917",
    blurb:
      "A crossing that never began: Endurance crushed in the Weddell Sea, the drift on the floes, eight hundred miles in an open boat, and every man brought home.",
  },
  {
    slug: "xuanzang-629",
    href: "/voyage/xuanzang-629",
    title: "Xuanzang's Journey to the Western Regions (629-645)",
    navigator: "Xuanzang",
    years: "",
    blurb:
      "Sixteen years on foot and by camel, out of Tang China against an imperial ban: the northern Silk Road, Samarkand, Bamiyan, and the years of study at Nalanda.",
  },
  {
    slug: "cartier-1534",
    href: "/voyage/cartier-1534",
    title: "Jacques Cartier and the St Lawrence (1534-1542)",
    navigator: "Jacques Cartier",
    years: "1534–1541",
    blurb:
      "Three voyages into the Gulf of St Lawrence: the cross raised at Gasp\u00e9, a winter at Stadacona cured by an Iroquoian remedy, and the journey to Hochelaga beneath the mountain he named Mont Royal.",
  },
  {
    slug: "dias-1487",
    href: "/voyage/dias-1487",
    title: "Bartolomeu Dias Rounds the Cape (1487-1488)",
    navigator: "Bartolomeu Dias",
    years: "1487–1488",
    blurb:
      "The voyage that proved the Atlantic and the Indian Ocean were one sea \u2014 and whose every record burned in the Lisbon earthquake of 1755.",
  },
  {
    slug: "gama-1497",
    href: "/voyage/gama-1497",
    title: "Vasco da Gama and the Sea Road to India (1497-1499)",
    navigator: "Vasco da Gama",
    years: "1497–1499",
    blurb:
      "The voyage that joined Europe to the Indian Ocean: a long arc into the open Atlantic to catch the westerlies, the Cape rounded ten years after Dias, up the Swahili coast past\u2026",
  },
  {
    slug: "drake-1577",
    href: "/voyage/drake-1577",
    title: "Drake's Circumnavigation (1577-1580)",
    navigator: "Francis Drake",
    years: "1577–1580",
    blurb:
      "The second circumnavigation and the first by a captain who survived it: south to Port San Juli\u00e1n and the execution of Thomas Doughty, through the Strait, up the Pacific coast\u2026",
  },
  {
    slug: "leoafricanus-1510",
    href: "/voyage/leoafricanus-1510",
    title: "Leo Africanus in Africa (c. 1510-1520)",
    navigator: "al-Hasan ibn Muhammad al-Wazzan (Leo Africanus)",
    years: "1514–1518",
    blurb:
      "North and West Africa described from inside it: Fez and Morocco, the Atlas passes, the Saharan crossings, Timbuktu and Gao under Songhai, the Niger, and eastward to Egypt \u2014 the\u2026",
  },
  {
    slug: "faxian-399",
    href: "/voyage/faxian-399",
    title: "Faxian's Journey to the Buddhist Kingdoms (399-414)",
    navigator: "Faxian",
    years: "",
    blurb:
      "Overland through Dunhuang and the desert to Khotan, over the Pamirs to Gandhara and the Ganges plain, years at Pataliputra copying texts, then Ceylon, and home by merchant ship\u2026",
  },
] as const satisfies readonly AtlasEntry[];

/** The atlas index as the rest of the app sees it. */
export const ATLAS: readonly AtlasEntry[] = ATLAS_ENTRIES;

/** Every published voyage's slug, as a union — the atlas is the one list. */
export type VoyageSlug = (typeof ATLAS_ENTRIES)[number]["slug"];

export function isVoyageSlug(slug: string): slug is VoyageSlug {
  return ATLAS.some((v) => v.slug === slug);
}

/** Where a voyage lives. Bougainville is served at the site root, so the
 *  mapping lives here once instead of being special-cased at each call site. */
export function voyagePath(slug: string): string {
  return slug === "boudeuse-1766" ? "/" : `/voyage/${slug}`;
}

/** The canonical, linkable path — the root voyage still needs an explicit
 *  address in the sitemap and in its own log's "back to the map" link. */
export function voyageMapPath(slug: string): string {
  return `/voyage/${slug}`;
}

export function voyageLogPath(slug: string): string {
  return `/voyage/${slug}/log`;
}
