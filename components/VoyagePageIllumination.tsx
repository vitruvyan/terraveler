import type { PageComposition } from "@/lib/voyageIllustrations";

/** Fixed page furniture: a continuous engraving for Cortés, restrained HQ-sheet
 * crops elsewhere. These are atmospheric marks, not historical evidence. */
export default function VoyagePageIllumination({ composition }: { composition: PageComposition }) {
  return (
    <div className="tv-log-illumination" data-composition={composition} aria-hidden="true">
      {composition === "mesoamerica" ? (
        <span className="tv-log-illumination-piece" data-motif="vertical-terrain" />
      ) : (
        <>
          <span className="tv-log-illumination-piece" data-motif="orography" />
          <span className="tv-log-illumination-piece" data-motif="charted-coast" />
          <span className="tv-log-illumination-piece" data-motif="regional-scene" />
        </>
      )}
    </div>
  );
}
