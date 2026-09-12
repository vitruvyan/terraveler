import type { Metadata } from "next";
import VoyageExperience from "@/components/VoyageExperience";
import { ATLAS } from "@/lib/voyages";
import Pigafetta from "@/components/Pigafetta";
import WelcomeCartouche from "@/components/WelcomeCartouche";
import { getVoyageBundle } from "@/lib/data";
import { voyageJsonLd, voyageMetadata } from "@/lib/seo";
import type { Waypoint } from "@/lib/types";

// Editorial content: it changes when the desk publishes, not per request.
// Served from Vercel's edge and regenerated in the background, which is also
// what makes it resilient — if the backend is unreachable at revalidation
// time the last good page keeps being served instead of erroring.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { voyage, navigator } = await getVoyageBundle();
  const m = voyageMetadata("boudeuse-1766", voyage, navigator);
  // The homepage keeps the site title; the voyage supplies the description.
  return { ...m, title: "Terraveler — an atlas of geo-history" };
}

export default async function Home() {
  // Choose a random voyage from the Atlas on each refresh.
  const randomIndex = Math.floor(Math.random() * ATLAS.length);
  const randomVoyage = ATLAS[randomIndex];
  const slug = randomVoyage.slug;

  const { navigator, voyage, waypoints } = await getVoyageBundle(slug);
  return (
    <>
      <VoyageExperience navigator={navigator} voyage={voyage} waypoints={waypoints as Waypoint[]}
        atlasCount={ATLAS.length} />
      <Pigafetta />
      <WelcomeCartouche />
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
