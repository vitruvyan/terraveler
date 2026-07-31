/** The plates the site opens its chapters with.
 *
 *  These images were being used as wallpaper: full-bleed, darkened to about a
 *  third of their luminance, with a title over them and an eleven-pixel credit
 *  in the corner. Four extraordinary engravings, and not one of them could be
 *  looked at — which is a strange thing for an atlas whose argument is that you
 *  should look at the evidence.
 *
 *  The plates chapter of the specimen sets the contract: url, caption, credit,
 *  licence, source. Four of the five are provenance. The site was applying that
 *  standard to a waypoint thumbnail and not to the image occupying the top
 *  third of every page, so the records live here and the openings use them.
 *
 *  Sources are the ones recorded in public/login-backgrounds/CREDITS.md.
 */

export type Plate = {
  url: string;
  caption: string;
  credit: string;
  license: string;
  source_url: string;
  /** When the image was made. Separate from `credit` because the two answers
   *  come apart: an engraving can be attributed with certainty and dated only
   *  to a decade, and a plate is regularly later than what it depicts. */
  date: string;
};

export const PLATES: Record<string, Plate> = {
  "/login-backgrounds/ortelius-world-map-1570.jpg": {
    url: "/login-backgrounds/ortelius-world-map-1570.jpg",
    caption:
      "Typus Orbis Terrarum — the world as Ortelius engraved it, with a Terra Australis nobody had seen drawn across the whole southern edge.",
    credit: "Abraham Ortelius",
    date: "1570",
    license: "public domain",
    source_url: "https://commons.wikimedia.org/wiki/File:OrteliusWorldMap1570.jpg",
  },
  "/login-backgrounds/fra-mauro-map.jpg": {
    url: "/login-backgrounds/fra-mauro-map.jpg",
    caption:
      "The Fra Mauro world map, drawn south-up in Venice a generation before the Portuguese rounded the Cape — as the Arab cartographers it borrowed from drew theirs.",
    credit: "Fra Mauro",
    date: "c. 1450",
    license: "public domain",
    source_url: "https://commons.wikimedia.org/wiki/File:FraMauroDetailedMap.jpg",
  },
  "/login-backgrounds/carta-marina.png": {
    url: "/login-backgrounds/carta-marina.png",
    caption:
      "Carta Marina — the northern seas, with the monsters drawn exactly where the soundings stopped.",
    credit: "Olaus Magnus",
    date: "1539",
    license: "public domain",
    source_url: "https://commons.wikimedia.org/wiki/File:CartaMarina.png",
  },
  "/login-backgrounds/celestial-planisphere-1835.jpg": {
    url: "/login-backgrounds/celestial-planisphere-1835.jpg",
    caption: "A celestial planisphere, or map of the heavens — the sky charted the way a coast is.",
    credit: "Library of Congress",
    date: "1835",
    license: "public domain",
    source_url:
      "https://commons.wikimedia.org/wiki/File:A_celestial_planisphere,_or_map_of_the_heavens_LOC_2013593157.jpg",
  },
  "/login-backgrounds/cellarius-planisphaerium-copernicanum.jpg": {
    url: "/login-backgrounds/cellarius-planisphaerium-copernicanum.jpg",
    caption:
      "Planisphaerium Copernicanum — the Copernican system drawn as a chart, a century after Copernicus and still an argument.",
    credit: "Andreas Cellarius",
    date: "1660",
    license: "public domain",
    source_url:
      "https://commons.wikimedia.org/wiki/File:Cellarius_Harmonia_Macrocosmica_-_Planisphaerium_Copernicanum.jpg",
  },
  "/login-backgrounds/cellarius-scenographia-copernicani.jpg": {
    url: "/login-backgrounds/cellarius-scenographia-copernicani.jpg",
    caption:
      "Scenographia Systematis Copernicani — the same system staged as a scene, with the planets carried on their orbits.",
    credit: "Andreas Cellarius",
    date: "1660",
    license: "public domain",
    source_url:
      "https://commons.wikimedia.org/wiki/File:Cellarius_Harmonia_Macrocosmica_-_Scenographia_Systematis_Copernicani.jpg",
  },
};

export function plateFor(src?: string): Plate | null {
  return src ? PLATES[src] ?? null : null;
}
