export type Confidence = "certain" | "approximate" | "reconstructed";

/** "earth" (the default, an Age-of-Sail voyage on a MapLibre map) or "space"
 *  (a probe's journey, rendered on the SVG orrery). Absent ⇒ "earth", so
 *  every existing voyage bundle stays backward compatible without edits. */
export type VoyageKind = "earth" | "space";

export interface Navigator {
  id: number;
  slug: string;
  name: string;
  nationality: string | null;
  birth_year: number | null;
  death_year: number | null;
  portrait_url: string | null;
  bio: string | null;
}

export interface Voyage {
  id: number;
  navigator_id: number;
  slug: string;
  title: string;
  ships: string | null;
  sponsor: string | null;
  purpose: string | null;
  start_date: string | null;
  end_date: string | null;
  summary: string | null;
  /** Omitted/undefined means "earth" — see VoyageKind. */
  kind?: VoyageKind;
}

export interface MediaItem {
  url: string;            // image URL (Wikimedia Commons / upload.wikimedia.org)
  caption: string;
  credit: string | null;
  source_url: string | null;  // Commons description page
  license: string;
}

export interface Waypoint {
  id: number;
  voyage_id: number;
  seq: number;
  place_historical: string | null;
  place_modern: string | null;
  latitude: number;
  longitude: number;
  arrival_date: string | null;
  departure_date: string | null;
  date_note: string | null;
  event: string | null;
  diary_excerpt: string | null;
  diary_source_citation: string | null;
  diary_source_url: string | null;
  confidence: Confidence;
  media_url: string | null;
  media?: MediaItem[];
}

/**
 * A waypoint on a "space" voyage: heliocentric polar position instead of
 * geographic latitude/longitude. `r_au` is distance from the Sun in
 * astronomical units; `theta_deg` is heliocentric ecliptic longitude in
 * degrees (0–360, measured the usual astronomical way — see
 * data/voyager2.json for how these were computed).
 */
export interface SpaceWaypoint {
  id: number;
  voyage_id: number;
  seq: number;
  /** The body encountered ("Jupiter", "Saturn", …) or a label for a
   *  non-flyby trajectory/cruise point ("Cruise (Earth–Jupiter)", "Heliopause"). */
  body: string;
  r_au: number;
  theta_deg: number;
  arrival_date: string | null;
  departure_date: string | null;
  date_note: string | null;
  event: string | null;
  diary_excerpt: string | null;
  diary_source_citation: string | null;
  diary_source_url: string | null;
  confidence: Confidence;
  media_url: string | null;
  media?: MediaItem[];
  /** true for a real planetary flyby (gets a clickable waypoint dot + a
   *  Mission Log entry); false/absent for an interpolated cruise-phase point
   *  added only to bend the trajectory path visually. */
  is_flyby?: boolean;
}
