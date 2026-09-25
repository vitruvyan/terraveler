import { POSTGREST_URL, postgrestConfigured } from "./backendConfig";
import { ATLAS, isVoyageSlug, type VoyageSlug } from "./voyages";
import type { Navigator, ProvenanceEntry, SpaceWaypoint, Voyage, Waypoint } from "./types";
import bougainville from "@/data/bougainville.json";
import laperouse from "@/data/laperouse.json";
import voyager2 from "@/data/voyager2.json";
import apollo11 from "@/data/apollo-11.json";
import cook from "@/data/cook.json";
import cortes from "@/data/cortes.json";
import darwin from "@/data/darwin-1831.json";
import magellan from "@/data/magellan-1519.json";
import pizarro from "@/data/pizarro-1532.json";
import columbus from "@/data/columbus-1492.json";
import shackleton from "@/data/shackleton-1914.json";
import xuanzang from "@/data/xuanzang-629.json";
import cartier from "@/data/cartier-1534.json";
import dias from "@/data/dias-1487.json";
import gama from "@/data/gama-1497.json";
import drake from "@/data/drake-1577.json";
import leoafricanus from "@/data/leoafricanus-1510.json";
import faxian from "@/data/faxian-399.json";
import polo_1271 from "@/data/polo-1271.json";
import lewisclark_1804 from "@/data/lewisclark-1804.json";
import mungopark_1795 from "@/data/mungopark-1795.json";
import ibnbattuta_1325 from "@/data/ibnbattuta-1325.json";
import cabot_1497 from "@/data/cabot-1497.json";

export interface VoyageBundle {
  navigator: Navigator;
  voyage: Voyage;
  waypoints: Waypoint[] | SpaceWaypoint[];
}

/**
 * The local atlas: bundled voyage data by slug.
 *
 * Keyed by VoyageSlug (derived from ATLAS), which is what keeps the two
 * registries honest: publish a voyage in ATLAS without adding its data here
 * and TypeScript reports the missing key; add data for a slug that isn't in
 * ATLAS — so it would never appear in the Atlas page or the sitemap — and it
 * reports the unknown one. Neither mistake can reach production.
 */
const LOCAL: Record<VoyageSlug, unknown> = {
  "boudeuse-1766": bougainville,
  "boussole-1785": laperouse,
  "voyager-2": voyager2,
  "apollo-11": apollo11,
  "cook-1768": cook,
  "cortes-1519": cortes,
  "darwin-1831": darwin,
  "magellan-1519": magellan,
  "pizarro-1532": pizarro,
  "columbus-1492": columbus,
  "shackleton-1914": shackleton,
  "xuanzang-629": xuanzang,
  "cartier-1534": cartier,
  "dias-1487": dias,
  "gama-1497": gama,
  "drake-1577": drake,
  "leoafricanus-1510": leoafricanus,
  "faxian-399": faxian,
  "polo-1271": polo_1271,
  "lewisclark-1804": lewisclark_1804,
  "mungopark-1795": mungopark_1795,
  "ibnbattuta-1325": ibnbattuta_1325,
  "cabot-1497": cabot_1497,
};

export function knownVoyages(): readonly string[] {
  return ATLAS.map((v) => v.slug);
}

/**
 * Picks one voyage slug uniformly at random from a pool (defaults to every
 * published voyage). Used so list_gaps's voyage_completeness rotates across
 * the atlas instead of always reporting on boudeuse-1766 — every bundled
 * voyage's waypoints share the same editorial fields (seq, diary_excerpt,
 * departure_date, confidence, media/media_url), so none needs excluding.
 */
export function pickRandomVoyageSlug(slugs: readonly string[] = knownVoyages()): string {
  return slugs[Math.floor(Math.random() * slugs.length)];
}

// Bundled at build time — reliable on Vercel with no runtime filesystem access.
function fromJson(slug: string): VoyageBundle {
  const bundle = isVoyageSlug(slug) ? LOCAL[slug] : undefined;
  return (bundle ?? bougainville) as VoyageBundle;
}

/**
 * Carta §3.5's provenance chain, read straight from the checked-in bundle —
 * never through getVoyageBundle()'s Postgres path. `voyages`/`waypoints` in
 * Postgres mirror what scripts/load_bundles.py copies from data/*.json for
 * fast reads on the map; "provenance" is not one of the columns it copies,
 * so the JSON bundle is the only place this ever lived and stays the source
 * of truth here regardless of which plane getVoyageBundle() served from.
 *
 * Normalizes the two legacy shapes a bundle may still carry — a lone object
 * (every bundle published between the mechanism's introduction and the fix
 * that made this a list) or nothing at all (bundles that predate §3.5, or
 * were authored outside the submission pipeline) — into the current list
 * shape, mirroring scripts/publish_submission.py's normalize_provenance().
 * An absent field returns an empty list: nothing to show, not an error.
 */
export function getVoyageProvenance(slug: string): ProvenanceEntry[] {
  const bundle = isVoyageSlug(slug) ? LOCAL[slug] : undefined;
  const provenance = (bundle as { provenance?: unknown } | undefined)?.provenance;
  if (provenance == null) return [];
  if (Array.isArray(provenance)) return provenance as ProvenanceEntry[];
  return [provenance as ProvenanceEntry];
}

async function postgrestRows(table: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(`/rest/v1/${table}`, `${POSTGREST_URL}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`PostgREST ${table}: ${response.status} ${(await response.text()).slice(0, 160)}`);
  }
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`PostgREST ${table}: expected an array`);
  return body;
}

/**
 * Loads a voyage bundle from the canonical DATA PLANE: PostgreSQL on the VPS
 * through PostgREST. Supabase is the identity provider only and is never
 * queried for atlas content. Bundled JSON remains the availability fallback.
 */
export async function getVoyageBundle(
  slug = "boudeuse-1766"
): Promise<VoyageBundle> {
  if (postgrestConfigured()) {
    try {
      const voyages = await postgrestRows("voyages", {
        select: "*",
        slug: `eq.${slug}`,
        limit: "1",
      });
      const voyage = voyages[0];

      if (voyage) {
        const [navigators, waypoints] = await Promise.all([
          postgrestRows("navigators", {
            select: "*",
            id: `eq.${voyage.navigator_id}`,
            limit: "1",
          }),
          postgrestRows("waypoints", {
            select: "*",
            voyage_id: `eq.${voyage.id}`,
            order: "seq.asc",
          }),
        ]);

        if (navigators[0] && waypoints.length > 0) {
          return {
            navigator: navigators[0] as Navigator,
            voyage: voyage as Voyage,
            waypoints: waypoints as Waypoint[],
          };
        }
      }
    } catch {
      // Availability first: if the VPS data plane is unavailable, use the
      // checked-in published bundle rather than accidentally querying Supabase.
    }
  }
  return fromJson(slug);
}
