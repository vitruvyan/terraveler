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
 * Rules if you add one: 24×24 box, weight 1.3, no two-tone, and it has to read
 * at 16px — test it there, not at 48.
 *
 * Stroke is the default and the morion is the single exception: it arrives as
 * a filled outline drawing rather than a stroked one. That is allowed because
 * the drawing's own bands measure ~1.4 units at this scale, which is the
 * weight everything else is stroked at — the exception is in how it is
 * expressed, not in how it looks. It also declares a floor of 22px, since a
 * double outline cannot survive 16. An icon may raise its floor; it may not
 * quietly ship below one.
 */

export type IconName =
  | "globe"
  | "anchor"
  | "bootprint"
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
  | "antenna"
  | "chart"
  | "orrery"
  | "record"
  | "lens"
  | "key"
  | "wheel"
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
  /* The bootprint: the log of a surface traverse.
     A Worlds voyage was showing an anchor beside its diary, because it renders
     through the Earth component and took the Earth icon with it. The most
     recognisable object of the whole enterprise is the print the boot left.
     Drawn once with ribbed treads, it read at 18px as a battery: parallel bars
     inside a straight-sided capsule. What makes a print a print is the shape,
     not the tread. Four candidates were drawn and rendered side by side at
     19, 26 and 48px rather than judged in the abstract: the two with a round
     toe and a round heel both read as a zero at small size. This one wins on
     the heel — wide, flat, and clearly set apart from the sole, which is what
     stops the pair collapsing into one glyph. Legible down to 16px. */
  bootprint: (
    <>
      <path d="M8.2 12.4c-.9-2.6-.6-5.2.9-7.6.8-1.3 2-1.9 3.6-1.7 2.2.3 3.6 1.7 4.1 4 .5 2.2.2 4.3-.9 6.2-.6 1-1.5 1.5-2.7 1.5H11c-1.3 0-2.3-.7-2.8-2.4z" />
      <path d="M9.2 18.6c0-1.3 1.2-2.1 2.9-2.1s2.9.8 2.9 2.1c0 .7-.1 1.4-.4 2-.4.9-1.2 1.4-2.5 1.4s-2.1-.5-2.5-1.4c-.3-.6-.4-1.3-.4-2z" />
    </>
  ),
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
     conquistadores actually wore.

     This is not a redrawing: it is the artwork itself, taken from a hand-drawn
     SVG and rebased into the 24-unit box. The transform was pure scale and
     translation, so the coordinates are baked in exactly rather than
     approximated; the source's degenerate segments (twenty-nine of them, the
     usual wobble a drawing tool leaves) are dropped and the precision trimmed
     to two decimals, which is far finer than a 24-unit box can show.

     It is the one FILLED icon in the set. That is not an exception to the
     stroke rule so much as a consequence of the drawing: measured, its black
     bands come to about 1.4 units at this scale, which is the weight the rest
     of the set is stroked at. Filled or stroked, it reads the same.

     Its floor is 22px, not the set's 16. The drawing carries a double outline
     — the outer silhouette and the bowl inside it — and below about 22 those
     two lines merge into a blob. Declared here rather than discovered later.
     Every call site passes 23 or more. */
  morion: (
    <path fillRule="evenodd" d="M13.48,3.14C13.57,3.2,14.53,3.56,16.12,5.31C16.63,6.13,16.89,6.94,17.08,7.46C17.15,7.67,17.21,7.84,17.27,7.93C17.77,8.66,18.24,8.97,18.69,9.01C19.02,9.04,19.33,8.93,19.63,8.74C19.93,8.55,20.21,8.27,20.47,8C20.87,7.56,21.22,7.11,21.48,6.92C21.61,6.82,21.72,6.79,21.82,6.83C21.98,6.9,22.11,7.05,22.21,7.28C22.34,7.6,22.41,8.07,22.4,8.64C22.37,10.82,21.28,14.44,19.34,16.43C19.04,16.82,14.55,21.98,6.89,21.74C4.43,21.66,2.87,21.02,2.29,20.42C2.09,20.21,2.01,20,2.04,19.82C2.08,19.64,2.23,19.49,2.51,19.39C3.36,19.09,4.09,18.93,4.58,18.73C4.87,18.61,5.07,18.48,5.18,18.28C5.25,18.14,5.27,17.97,5.22,17.75C5.17,17.52,5.05,17.23,4.85,16.89C4.68,16.58,4.29,16.19,3.85,15.69C2.8,14.5,1.41,12.66,1.62,9.7C2.04,3.73,8.46,0.6,13.48,3.14ZM19.83,14.55C21.67,11.62,21.79,8.91,21.6,8.07C21.58,7.97,21.56,7.9,21.53,7.86L21.51,7.84C21.36,7.96,21.29,8.09,21.2,8.24C21,8.58,20.76,9.01,19.58,9.55C19.36,9.65,19.17,9.68,19.04,9.72C18.95,9.75,18.88,9.78,18.84,9.84C18.79,9.91,18.77,10.01,18.76,10.18C18.75,11.6,19.14,11.97,18.02,14.3C16.32,16.49,15.54,17.16,14.02,17.93C13.21,18.34,12.18,18.76,10.64,19.17C8.66,19.48,7.31,19.04,6.57,18.78C6.38,18.71,6.23,18.66,6.12,18.63C6.06,18.61,6.01,18.61,5.98,18.62C5.95,18.62,5.93,18.64,5.89,18.67C5.79,18.76,5.55,18.97,4.62,19.47C4.42,19.57,3.31,19.85,2.98,20.06C2.95,20.07,2.93,20.09,2.92,20.11L2.91,20.13C2.95,20.17,3.12,20.24,3.35,20.33C3.89,20.54,4.76,20.81,5.09,20.87C6.82,21.16,8.27,21.11,10.07,20.85C10.1,20.84,10.13,20.83,10.17,20.83C10.98,20.74,13.85,19.84,15.69,18.74C16.51,18.25,17.89,17.29,18.5,16.49C19.82,14.77,19.44,15.21,19.83,14.54ZM8.04,7.04C6.71,7.7,5.95,9.16,5.56,10.74C4.96,13.12,5.17,15.8,5.43,16.5C5.89,17.71,6.84,18.29,7.86,18.52C8.87,18.75,9.96,18.63,10.69,18.44C11.71,18.22,14.8,17.61,17.28,14.19C17.51,13.9,17.48,13.89,17.62,13.55C18.12,12.33,18.36,11.44,18.23,10.65C18.09,9.86,17.58,9.16,16.57,8.31C12.84,5.18,9.72,6.36,8.54,6.72C8.28,6.86,8.29,6.86,8.04,7.04ZM4.4,14.9C4.4,14.88,4.4,14.76,4.41,14.57C4.45,13.79,4.61,11.84,4.85,10.6C5.39,7.84,7.45,6.01,10.17,5.63C11.99,5.37,14.06,5.82,16.16,7.23C16.21,7.26,16.25,7.28,16.29,7.29C16.31,7.3,16.33,7.29,16.35,7.29C16.37,7.28,16.38,7.26,16.39,7.24C16.4,7.21,16.4,7.18,16.39,7.14C16.33,6.85,15.92,6.16,15.89,6.11C14.4,4.24,12.73,3.29,11.09,2.96C7.25,2.2,3.55,4.9,2.65,7.66C1.67,10.65,2.67,12.77,3.52,14.33C3.56,14.38,3.8,14.71,4,14.92C4.1,15.01,4.18,15.08,4.25,15.1C4.32,15.11,4.36,15.11,4.38,15.09C4.4,15.07,4.41,15.05,4.42,15.02C4.42,14.99,4.41,14.95,4.4,14.9Z" />
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

  /* The Voyager theme's four. A probe's instruments are not a ship's, but they
     are drawn the same way: as the diagram a treatise would print. */

  /* Mission log. For a probe the record did not come home in a chest — it came
     down a dish. */
  antenna: (
    <>
      <path d="M3.4 12.8a7.6 7.6 0 0 1 10.2-10.2z" />
      <path d="M8.6 7.6 12.6 11.9" />
      <circle cx="13.2" cy="12.5" r="1.2" />
      <path d="M9 13.8 7.8 20.5" />
      <path d="M5.2 20.5h6.2" />
    </>
  ),

  /* Telemetry: a reading plotted against an axis. */
  chart: (
    <>
      <path d="M4 3.6v16.8h16.4" />
      <path d="M6.8 16.4 10.6 11 13.8 13.4 19.6 5.9" />
      <circle cx="10.6" cy="11" r="0.95" />
      <circle cx="13.8" cy="13.4" r="0.95" />
    </>
  ),

  /* The orrery: orbits about a primary, tilted so the rings do not stack into
     a target. */
  orrery: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <ellipse cx="12" cy="12" rx="9.2" ry="4" transform="rotate(-18 12 12)" />
      <ellipse cx="12" cy="12" rx="5.9" ry="2.6" transform="rotate(22 12 12)" />
      <circle cx="20.5" cy="9.2" r="1.1" />
    </>
  ),

  /* The Golden Record — a phonograph disc, which is what it is. */
  record: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="3.3" />
      <circle cx="12" cy="12" r="0.9" />
    </>
  ),

  /* Searching. A reading glass — the instrument you actually hold over a
     chart, rather than the abstract magnifier. */
  lens: (
    <>
      <circle cx="10.6" cy="10.6" r="6.4" />
      <path d="M15.2 15.2 20.4 20.4" />
      <path d="M7.6 8.4a4.2 4.2 0 0 1 2.6-1.6" />
    </>
  ),

  /* Connecting an assistant: the handshake hands over a key. */
  key: (
    <>
      <circle cx="7.4" cy="12" r="3.6" />
      <path d="M11 12h9.8" />
      <path d="M17.4 12v3.6M20.4 12v2.7" />
    </>
  ),

  /* The crew. A ship's wheel — hub, rim and handles. */
  wheel: (
    <>
      <circle cx="12" cy="12" r="6.1" />
      <circle cx="12" cy="12" r="1.9" />
      <path d="M12 5.9V2.2M12 21.8v-3.7M5.9 12H2.2M21.8 12h-3.7" />
      <path d="M7.7 7.7 5.1 5.1M16.3 7.7l2.6-2.6M7.7 16.3l-2.6 2.6M16.3 16.3l2.6 2.6" />
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

/* Everything here is stroked except the morion, which arrives as a filled
   outline drawing. Kept as a set rather than a per-icon flag so the exception
   stays countable. */
const FILLED = new Set<IconName>(["morion"]);

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
      fill={FILLED.has(name) ? "currentColor" : "none"}
      stroke={FILLED.has(name) ? "none" : "currentColor"}
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
