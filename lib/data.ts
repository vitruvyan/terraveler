import { supabase } from "./supabase";
import type { Navigator, SpaceWaypoint, Voyage, Waypoint } from "./types";
import bougainville from "@/data/bougainville.json";
import laperouse from "@/data/laperouse.json";
import voyager2 from "@/data/voyager2.json";
import apollo11 from "@/data/apollo-11.json";
import cook from "@/data/cook.json";

export interface VoyageBundle {
  navigator: Navigator;
  voyage: Voyage;
  waypoints: Waypoint[] | SpaceWaypoint[];
}

function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  );
}

// The local atlas: bundled voyages by slug (DB takes precedence when present).
const LOCAL: Record<string, unknown> = {
  "boudeuse-1766": bougainville,
  "boussole-1785": laperouse,
  "voyager-2": voyager2,
  "apollo-11": apollo11,
  "cook-1768": cook,
};

export function knownVoyages(): string[] {
  return Object.keys(LOCAL);
}

// Bundled at build time — reliable on Vercel with no runtime filesystem access.
function fromJson(slug: string): VoyageBundle {
  return (LOCAL[slug] ?? bougainville) as VoyageBundle;
}

/**
 * Loads a voyage bundle. Prefers Supabase when configured, and falls back to
 * the bundled JSON so the prototype renders even before Supabase is wired.
 */
export async function getVoyageBundle(
  slug = "boudeuse-1766"
): Promise<VoyageBundle> {
  if (hasSupabase()) {
    try {
      const { data: voyage } = await supabase
        .from("voyages")
        .select("*")
        .eq("slug", slug)
        .single();

      if (voyage) {
        const [navRes, wpRes] = await Promise.all([
          supabase
            .from("navigators")
            .select("*")
            .eq("id", voyage.navigator_id)
            .single(),
          supabase
            .from("waypoints")
            .select("*")
            .eq("voyage_id", voyage.id)
            .order("seq", { ascending: true }),
        ]);

        if (navRes.data && wpRes.data && wpRes.data.length > 0) {
          return {
            navigator: navRes.data as Navigator,
            voyage: voyage as Voyage,
            waypoints: wpRes.data as Waypoint[],
          };
        }
      }
    } catch {
      // fall through to the bundled JSON
    }
  }
  return fromJson(slug);
}
