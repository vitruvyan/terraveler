import VoyageExperience from "@/components/VoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import { getVoyageBundle } from "@/lib/data";
import type { Waypoint } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The homepage always serves the default Earth voyage (Bougainville).
  const { navigator, voyage, waypoints } = await getVoyageBundle();
  return (
    <>
      <VoyageExperience navigator={navigator} voyage={voyage} waypoints={waypoints as Waypoint[]} />
      <Pigafetta />
    </>
  );
}
