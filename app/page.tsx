import type { Metadata } from "next";
import VoyageExperience from "@/components/VoyageExperience";
import Pigafetta from "@/components/Pigafetta";
import WelcomeCartouche from "@/components/WelcomeCartouche";
import { getVoyageBundle } from "@/lib/data";
import { voyageJsonLd, voyageMetadata } from "@/lib/seo";
import type { Waypoint } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { voyage, navigator } = await getVoyageBundle();
  const m = voyageMetadata("boudeuse-1766", voyage, navigator);
  // The homepage keeps the site title; the voyage supplies the description.
  return { ...m, title: "Terraveler — an atlas of geo-history" };
}

export default async function Home() {
  // The homepage always serves the default Earth voyage (Bougainville).
  const { navigator, voyage, waypoints } = await getVoyageBundle();
  return (
    <>
      <VoyageExperience navigator={navigator} voyage={voyage} waypoints={waypoints as Waypoint[]} />
      <Pigafetta />
      <WelcomeCartouche />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(voyageJsonLd("boudeuse-1766", voyage, navigator, waypoints.length)),
        }}
      />
    </>
  );
}
