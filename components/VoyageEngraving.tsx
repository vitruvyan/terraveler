import type { VoyageIllustration } from "@/lib/voyageIllustrations";

/** A background engraving in the page margin, with no evidentiary meaning. */
export default function VoyageEngraving({
  theme,
}: {
  theme: VoyageIllustration | null;
}) {
  if (!theme) return null;
  return (
    <span
      className="tv-voyage-engraving"
      data-theme={theme}
      aria-hidden="true"
    />
  );
}
