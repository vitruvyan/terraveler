import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VoyageExperience from "@/components/VoyageExperience";
import { ATLAS } from "@/lib/voyages";
import SpaceVoyageExperience from "@/components/SpaceVoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import { getVoyageBundle, knownVoyages } from "@/lib/data";
import { resolveRender } from "@/lib/voyages";
import { voyageJsonLd, voyageMetadata } from "@/lib/seo";
import type { SpaceWaypoint, Waypoint } from "@/lib/types";

// Editorial content: it changes when the desk publishes, not per request.
// Served from Vercel's edge and regenerated in the background, which is also
// what makes it resilient — if the backend is unreachable at revalidation
// time the last good page keeps being served instead of erroring.
export const revalidate = 300;

/** Prerendered at build time, so the first reader of a voyage is served from
 *  the edge rather than waiting for it to be rendered. */
export async function generateStaticParams() {
  return knownVoyages().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) return {};
  const { voyage, navigator } = await getVoyageBundle(slug);
  return voyageMetadata(slug, voyage, navigator);
}

export default async function VoyagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) notFound();
  const { navigator, voyage, waypoints } = await getVoyageBundle(slug);
  const render = resolveRender(voyage);
  return (
    <>
      {render === "orbital" ? (
        <SpaceVoyageExperience
          navigator={navigator}
          voyage={voyage}
          waypoints={waypoints as SpaceWaypoint[]}
          atlasCount={ATLAS.length}
        />
      ) : (
        <VoyageExperience
          navigator={navigator}
          voyage={voyage}
          waypoints={waypoints as Waypoint[]}
          atlasCount={ATLAS.length}
          body={voyage.body ?? "earth"}
        />
      )}
      {/* Pigafetta answers where a RAG corpus exists (Bougainville, Cook). */}
      {(slug === "boudeuse-1766" || slug === "cook-1768" || slug === "cortes-1519") && (
        <Pigafetta voyage={slug} />
      )}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(voyageJsonLd(slug, voyage, navigator, waypoints.length)),
        }}
      />
    </>
  );
}
