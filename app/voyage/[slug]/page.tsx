import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VoyageExperience from "@/components/VoyageExperience";
import SpaceVoyageExperience from "@/components/SpaceVoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import { getVoyageBundle, knownVoyages } from "@/lib/data";
import { resolveRender } from "@/lib/voyages";
import { voyageJsonLd, voyageMetadata } from "@/lib/seo";
import type { SpaceWaypoint, Waypoint } from "@/lib/types";

export const dynamic = "force-dynamic";

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
        />
      ) : (
        <VoyageExperience
          navigator={navigator}
          voyage={voyage}
          waypoints={waypoints as Waypoint[]}
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
