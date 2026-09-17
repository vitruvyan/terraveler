import type { PageComposition } from "@/lib/voyageIllustrations";

/** Fixed left-margin furniture. An atmospheric mark, not historical evidence. */
export default function VoyagePageIllumination({ composition }: { composition: PageComposition }) {
  return (
    <div className="tv-log-illumination" data-composition={composition} aria-hidden="true">
      <span className="tv-log-illumination-piece" data-motif="vertical-terrain" />
    </div>
  );
}
