import type { VoyageIllustration } from "@/lib/voyageIllustrations";

/** A cropped piece of the illustration library, with no evidentiary meaning. */
export default function VoyageEngraving({
  theme,
  compact = false,
}: {
  theme: VoyageIllustration | null;
  compact?: boolean;
}) {
  if (!theme) return null;
  return (
    <span
      className={`tv-voyage-engraving${compact ? " tv-voyage-engraving--compact" : ""}`}
      data-theme={theme}
      aria-hidden="true"
    />
  );
}
