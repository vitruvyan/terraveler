import VoyageExperience from "@/components/VoyageExperience";
import { getVoyageBundle } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { navigator, voyage, waypoints } = await getVoyageBundle();
  return (
    <VoyageExperience navigator={navigator} voyage={voyage} waypoints={waypoints} />
  );
}
