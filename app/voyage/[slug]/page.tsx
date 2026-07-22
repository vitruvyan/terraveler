import { notFound } from "next/navigation";
import VoyageExperience from "@/components/VoyageExperience";
import SpaceVoyageExperience from "@/components/SpaceVoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import { getVoyageBundle, knownVoyages } from "@/lib/data";
import { resolveRender } from "@/lib/voyages";
import type { SpaceWaypoint, Waypoint } from "@/lib/types";

export const dynamic = "force-dynamic";

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
      {/* Pigafetta's corpus covers Bougainville for now. */}
      {slug === "boudeuse-1766" && <Pigafetta />}
    </>
  );
}
