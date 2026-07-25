import type { Metadata } from "next";
import type { Navigator, SpaceWaypoint, Voyage, Waypoint } from "./types";

/** Shared metadata + JSON-LD builders for the home voyage and every
 *  /voyage/[slug] page, so search engines and AI crawlers get a real
 *  description and a structured Article per voyage — not just the map. */

export function voyageDescription(voyage: Voyage, navigator: Navigator): string {
  if (voyage.summary) return voyage.summary;
  const years =
    voyage.start_date && voyage.end_date
      ? `${voyage.start_date.slice(0, 4)}–${voyage.end_date.slice(0, 4)}`
      : "";
  return `${voyage.title}: ${navigator.name}${years ? `, ${years}` : ""}. A voyage told stage by stage, from the navigator's own journal, every claim sourced.`;
}

export function voyageMetadata(
  slug: string,
  voyage: Voyage,
  navigator: Navigator
): Metadata {
  const description = voyageDescription(voyage, navigator);
  const path = slug === "boudeuse-1766" ? "/" : `/voyage/${slug}`;
  return {
    title: voyage.title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: voyage.title, description },
    twitter: { card: "summary_large_image", title: voyage.title, description },
  };
}

/** schema.org Article — the voyage as a sourced work, its author the
 *  navigator whose journal supplies the (verbatim) content. */
export function voyageJsonLd(
  slug: string,
  voyage: Voyage,
  navigator: Navigator,
  waypointCount: number
) {
  const path = slug === "boudeuse-1766" ? "/" : `/voyage/${slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: voyage.title,
    description: voyageDescription(voyage, navigator),
    url: `https://www.terraveler.com${path}`,
    datePublished: voyage.start_date ?? undefined,
    about: {
      "@type": "Person",
      name: navigator.name,
      nationality: navigator.nationality ?? undefined,
      birthDate: navigator.birth_year ? String(navigator.birth_year) : undefined,
      deathDate: navigator.death_year ? String(navigator.death_year) : undefined,
    },
    author: { "@type": "Organization", name: "Terraveler" },
    publisher: { "@type": "Organization", name: "Terraveler", url: "https://www.terraveler.com" },
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
    numberOfItems: waypointCount,
  };
}

export function isSpaceWaypoint(w: Waypoint | SpaceWaypoint): w is SpaceWaypoint {
  return !("place_historical" in w);
}
