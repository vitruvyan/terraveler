import { illustrationScenes, type IllustrationScene } from "@/lib/voyageIllustrations";

/** A mounted editorial illustration, explicitly distinct from sourced waypoint plates. */
export default function VoyageEngraving({ scene, className = "" }: { scene: IllustrationScene; className?: string }) {
  const illustration = illustrationScenes[scene];
  return (
    <figure className={`tv-editorial-figure ${className}`}>
      <div className="tv-editorial-mount">
        <div className="tv-editorial-crop" data-sheet={illustration.sheet}
          data-column={illustration.column} data-row={illustration.row}
          role="img" aria-label={illustration.label} />
      </div>
      <figcaption>
        <p>{illustration.label}. {illustration.context}</p>
        <span>Terraveler · original editorial illustration · 2026 · reuse terms not stated · <a href="/specimen/illustration">source sheet</a></span>
      </figcaption>
    </figure>
  );
}
