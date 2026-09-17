import type { CSSProperties } from "react";
import { illuminationBackgrounds, type PageComposition } from "@/lib/voyageIllustrations";

/** Fixed left-margin furniture. An atmospheric mark, not historical evidence. */
export default function VoyagePageIllumination({ composition }: { composition: PageComposition }) {
  const artwork = illuminationBackgrounds[composition];
  return (
    <div
      className="tv-log-illumination"
      data-composition={composition}
      style={{ "--illumination-image": `url("${artwork.src}")` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="tv-log-illumination-piece" data-motif="vertical-terrain" />
    </div>
  );
}
