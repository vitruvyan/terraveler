export type Confidence = "certain" | "approximate" | "reconstructed";

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
}
