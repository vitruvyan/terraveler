/* The atlas's own icons.
 *
 * Everything here used to be an emoji — 🌐 for the atlas itself, ⚓🗺🧭🖼🗿 for
 * the lenses, 👤 for the reader, ✒ for contributing. Two problems with that,
 * and neither is taste: an emoji is drawn by Apple or Google or Microsoft
 * depending on who is looking, so the mark of the atlas was not ours and was
 * not the same twice; and they arrive full of cartoon colour, on a page whose
 * whole argument is ink on parchment.
 *
 * These are drawn as line, in `currentColor`, with no fill — instrument
 * diagrams from an eighteenth-century treatise rather than pictograms. They
 * inherit colour and size from whatever they sit in, so a lens button that
 * goes active or a header on the starfield theme needs no icon variant.
 *
 * Rules if you add one: 24×24 box, stroke only, weight 1.3, no fill, no
 * two-tone. It has to read at 16px — test it there, not at 48.
 */

export type IconName =
  | "globe"
  | "anchor"
  | "map"
  | "compass"
  | "plates"
  | "antiquity"
  | "scroll"
  | "quill"
  | "menu"
  | "morion"
  | "pin"
  | "hourglass"
  | "arrow-up"
  | "check"
  | "close"
  | "play"
  | "pause";

const PATHS: Record<IconName, React.ReactNode> = {
  /* The atlas itself: a sphere reduced to its graticule, the way a globe is
     drawn on a title page rather than photographed. */
  globe: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <ellipse cx="12" cy="12" rx="3.7" ry="8.6" />
      <path d="M3.4 12h17.2" />
      <path d="M4.9 7.2h14.2M4.9 16.8h14.2" />
    </>
  ),

  /* The voyage lens. */
  anchor: (
    <>
      <circle cx="12" cy="4.4" r="1.7" />
      <path d="M12 6.1V20.4" />
      <path d="M8.2 8.7h7.6" />
      <path d="M4.4 13.4c0 3.9 3.4 7 7.6 7s7.6-3.1 7.6-7" />
      <path d="M4.4 13.4h2.6M19.6 13.4H17" />
    </>
  ),

  /* Historical borders: a folded sheet. */
  map: (
    <>
      <path d="M3.4 6.6 9 4.2l6 2.4 5.6-2.4v13l-5.6 2.4-6-2.4-5.6 2.4z" />
      <path d="M9 4.2v13M15 6.6v13" />
    </>
  ),

  /* The cartographer's lens. A wind rose rather than a needle: a single
     tilted lozenge came out a thin sliver at 18px and read as a slash. */
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 4.6 13.5 10.5 19.4 12 13.5 13.5 12 19.4 10.5 13.5 4.6 12 10.5 10.5z" />
    </>
  ),

  /* Engraved plates. */
  plates: (
    <>
      <rect x="3.4" y="4.8" width="17.2" height="14.4" />
      <path d="M3.4 15.4l4.8-4 3.4 2.9 2.9-2.5 6.1 5" />
      <circle cx="8.4" cy="9.2" r="1.3" />
    </>
  ),

  /* Antiquities: a temple front. Two columns read as a doorway at small size;
     three read as a ruin, which is the point. */
  antiquity: (
    <>
      <path d="M3.6 20.4h16.8" />
      <path d="M6.6 20.4V9M12 20.4V9M17.4 20.4V9" />
      <path d="M4.2 9h15.6l-2.2-3.4H6.4z" />
    </>
  ),

  /* Read as text. */
  scroll: (
    <>
      <path d="M6.6 4.4h9.8a1.9 1.9 0 0 1 1.9 1.9v11.4a1.9 1.9 0 0 0 1.9 1.9H8.5a1.9 1.9 0 0 1-1.9-1.9V4.4z" />
      <path d="M6.6 4.4a1.9 1.9 0 0 0-1.9 1.9v1.9h1.9" />
      <path d="M9.6 9h6.4M9.6 12.2h6.4M9.6 15.4h4.2" />
    </>
  ),

  /* Contribute: the scribe's quill. */
  quill: (
    <>
      <path d="M4.2 20.2c5.9-.9 9.1-3.7 11.1-7.7 2-4 2.1-6.2 2.1-8.3-3.1 0-6.1 1-9 3.9s-4.2 8-4.2 12.1z" />
      <path d="M4.2 20.2 9.6 14.8" />
      <path d="M13.4 8.4c-1.6 1.1-2.9 2.6-3.8 4.4" />
    </>
  ),

  menu: <path d="M3.8 7h16.4M3.8 12h16.4M3.8 17h16.4" />,

  /* The reader. A morion — the comb-crested, up-swept helmet the
     conquistadores actually wore — rather than the generic bust.
     Drawn in profile, because that is the only view in which a morion is
     unmistakable: the brim sweeps down and turns up to a point at each end,
     and the crest rides over the bowl. Seen head-on it reads as a bridge. */
  morion: (
    <>
      {/* the brim, swept up to a spike fore and aft */}
      <path d="M1.9 16.2c3.3 3.6 6.7 5.1 10.1 5.1s6.8-1.5 10.1-5.1" />
      <path d="M1.9 16.2 6.4 13.4M22.1 16.2 17.6 13.4" />
      {/* Skull and comb as one silhouette. Drawn as two arcs the comb floated
          above the dome and the apex turned to mush; the comb IS the point. */}
      <path d="M6.2 15.1C6.2 9.7 8.1 5 12 2.1c3.9 2.9 5.8 7.6 5.8 13" />
    </>
  ),

  pin: (
    <>
      <path d="M12 20.8s6.8-6.4 6.8-10.8a6.8 6.8 0 1 0-13.6 0c0 4.4 6.8 10.8 6.8 10.8z" />
      <circle cx="12" cy="9.8" r="2.4" />
    </>
  ),

  /* An era. An hourglass, not a clock — the atlas does not keep office hours. */
  hourglass: (
    <>
      <path d="M7 3.6h10M7 20.4h10" />
      <path d="M8.2 3.6v3.3c0 2 3.8 3.6 3.8 5.1s-3.8 3.1-3.8 5.1v3.3" />
      <path d="M15.8 3.6v3.3c0 2-3.8 3.6-3.8 5.1s3.8 3.1 3.8 5.1v3.3" />
    </>
  ),

  "arrow-up": (
    <>
      <path d="M12 20.2V4.6" />
      <path d="M5.4 11.2 12 4.6l6.6 6.6" />
    </>
  ),
  check: <path d="M4.6 12.4 9.5 17.4 19.4 6.6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M8.4 4.8 18.6 12 8.4 19.2z" />,
  pause: <path d="M9 5v14M15 5v14" />,
};

export default function Icon({
  name,
  size = 18,
  className,
  title,
}: {
  name: IconName;
  size?: number | string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      style={{ flex: "0 0 auto", display: "block" }}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
