import { notFound } from "next/navigation";
import VoyageExperience from "@/components/VoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import { getVoyageBundle, knownVoyages } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function VoyagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!knownVoyages().includes(slug)) notFound();
  const { navigator, voyage, waypoints } = await getVoyageBundle(slug);
  return (
    <>
      <VoyageExperience navigator={navigator} voyage={voyage} waypoints={waypoints} />
      {/* Pigafetta's corpus covers Bougainville for now. */}
      {slug === "boudeuse-1766" && <Pigafetta />}
    </>
  );
}
