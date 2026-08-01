import type { BodyId } from "./types";

/**
 * Returns a MapLibre `{ sources, layers }` pair for the given body's
 * basemap. Used verbatim as the `style` of the `new gl.Map({...})` call in
 * components/VoyageExperience.tsx.
 *
 * "earth" reproduces, byte-for-byte, the CARTO `light_nolabels` raster block
 * that VoyageExperience used inline before this file existed — Earth voyages
 * must render identically to before.
 *
 * "moon" and "mars" use the OpenPlanetary (OPM) basemap tile server: XYZ
 * raster tiles in standard Web-Mercator tiling (`{z}/{x}/{y}.png`), so they
 * drop into MapLibre exactly like any other raster source, no projection
 * changes needed. Verified live on 2026-07-22 — see the report accompanying
 * this change for the exact curl checks (both returned real 256×256 PNG
 * tiles; the Moon tile at the Apollo 11 site even carries an OPM place-name
 * label reading "Statio Tranquillitatis / Apollo 11"):
 *   Moon: https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-moon-basemap-v0-1/all/{z}/{x}/{y}.png
 *   Mars: https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png
 */
export function basemapStyle(body: BodyId): { version: 8; sources: any; layers: any[] } {
  if (body === "moon" || body === "mars") {
    const named = body === "moon" ? "opm-moon-basemap-v0-1" : "opm-mars-basemap-v0-2";
    const bg = body === "moon" ? "#0a0a0c" : "#0d0a08";
    return {
      version: 8,
      sources: {
        opm: {
          type: "raster",
          tiles: [
            `https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/${named}/all/{z}/{x}/{y}.png`,
          ],
          tileSize: 256,
          maxzoom: 9,
          attribution: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": bg } },
        { id: "opm", type: "raster", source: "opm", paint: { "raster-opacity": 1 } },
      ],
    };
  }

  // "earth" — verbatim copy of the original inline block in VoyageExperience.
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#dfe4e6" } },
      { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 1 } },
    ],
  };
}

/** A short body-identity blurb for the Cartographer lens on non-Earth voyages. */
export function bodyBlurb(body: BodyId): string {
  switch (body) {
    case "moon":
      return "The Moon — LRO WAC mosaic; coordinates planetocentric east-longitude.";
    case "mars":
      return "Mars — MOLA/viking mosaic; coordinates planetocentric east-longitude.";
    default:
      return "";
  }
}

export const TILE_ATTRIBUTION: Record<BodyId, string> = {
  earth: "© OpenStreetMap contributors © CARTO",
  moon: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
  mars: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
  venus: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
  mercury: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
  titan: "Map tiles © OpenPlanetary · data NASA/USGS/JPL",
};

/* Collapse MapLibre's attribution to its own (i) button on a phone.
 *
 * Measured at 412×883: it renders EXPANDED as a full 338×44 band — 4.1% of the
 * screen, permanently, to say what its button says on request. This is a
 * collapse and not a removal: OpenStreetMap and CARTO are still credited, and
 * the compact form is the library's own sanctioned one, so nothing about the
 * licence changes.
 *
 * It reads the layout attribute rather than a width, because the boundary is
 * spelled once in lib/layout.ts and `test/layout.test.ts` fails a viewport
 * width written by hand anywhere else. Called from both experiences, because
 * a fix that lands in one map and not the other is how the Space copy has
 * twice gone quietly stale.
 */
export function collapseAttributionOnPhone(container: HTMLElement | null): void {
  if (!container) return;
  if (document.documentElement.getAttribute("data-layout") !== "phone") return;
  const attrib = container.querySelector("details.maplibregl-ctrl-attrib");
  if (attrib instanceof HTMLDetailsElement) attrib.open = false;
}
