import type { IllustrationScene } from "@/lib/voyageIllustrations";

/** A page-edge typographic ornament, not a sourced illustration or figure. */
export default function VoyageEngraving({ scene }: { scene: IllustrationScene }) {
  return <span className="tv-page-engraving" data-scene={scene} aria-hidden="true" />;
}
