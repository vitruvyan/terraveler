/* Printer's ornament.
 *
 * The design law says the ornament budget is spent on typography, rules and
 * white space — so this is a small vocabulary, not a catalogue, and it is
 * deliberately the sober end of what the reference sheets offer. What a
 * sixteenth-century printer actually had was a lozenge, a pair of swashes and
 * a leaf; the florid corner-pieces belong to a wedding invitation, and putting
 * them on a page of measured contrast ratios would undo the argument the rest
 * of the site makes.
 *
 * Same rules as the icons: stroke only, currentColor, no fill, and it has to
 * survive being small. These sit at --brass by default because an ornament is
 * a mark, not a word, and --brass is the mark.
 */

export type OrnamentName = "fleuron" | "break" | "tail" | "corner";

const ART: Record<OrnamentName, { box: string; d: React.ReactNode }> = {
  /* The lozenge and its two curls, on their own. A section mark. */
  fleuron: {
    box: "0 0 40 16",
    d: (
      <>
        <path d="M20 3.4 22.9 8 20 12.6 17.1 8z" />
        <path d="M16.5 8c-2.6 0-4.2-2.7-7.2-2.7C6.9 5.3 5.5 6.5 5.5 8s1.4 2.7 3.8 2.7c3 0 4.6-2.7 7.2-2.7" />
        <path d="M23.5 8c2.6 0 4.2-2.7 7.2-2.7 2.4 0 3.8 1.2 3.8 2.7s-1.4 2.7-3.8 2.7c-3 0-4.6-2.7-7.2-2.7" />
      </>
    ),
  },

  /* The same, carried out to a rule on both sides: the break a printer sets
     between two movements of an argument. */
  break: {
    box: "0 0 200 16",
    d: (
      <>
        <path d="M0 8h72M128 8h72" />
        <path d="M100 3.4 102.9 8 100 12.6 97.1 8z" />
        <path d="M96.5 8c-2.6 0-4.2-2.7-7.2-2.7-2.4 0-3.8 1.2-3.8 2.7s1.4 2.7 3.8 2.7c3 0 4.6-2.7 7.2-2.7" />
        <path d="M103.5 8c2.6 0 4.2-2.7 7.2-2.7 2.4 0 3.8 1.2 3.8 2.7s-1.4 2.7-3.8 2.7c-3 0-4.6-2.7-7.2-2.7" />
      </>
    ),
  },

  /* A terminal flourish: the mark that says a chapter has finished, so the
     reader does not have to infer it from white space. */
  tail: {
    box: "0 0 64 20",
    d: (
      <>
        <path d="M32 4v6" />
        <path d="M32 10c-3.6 0-5.6 3.4-10 3.4-3.4 0-5.4-1.6-5.4-3.4" />
        <path d="M32 10c3.6 0 5.6 3.4 10 3.4 3.4 0 5.4-1.6 5.4-3.4" />
        <path d="M16.6 10c0-1.8 2-3.4 5.4-3.4M47.4 10c0-1.8-2-3.4-5.4-3.4" />
      </>
    ),
  },

  /* A corner. One arc, one leaf — enough to say the page is framed without
     the page becoming the frame. */
  corner: {
    box: "0 0 44 44",
    d: (
      <>
        <path d="M2 42C2 22 8.4 10.4 20 5.2 26 2.6 33.4 2 42 2" />
        <path d="M42 2c-5.6.5-9.2 2.5-10.6 5.6-1 2.2.2 4.2 2.4 4.2 2.3 0 3.8-1.9 3.8-4.2 0-2.9-2.3-4.9-6.6-5.6" />
        <path d="M2 42c.5-5.6 2.5-9.2 5.6-10.6 2.2-1 4.2.2 4.2 2.4 0 2.3-1.9 3.8-4.2 3.8-2.9 0-4.9-2.3-5.6-6.6" />
      </>
    ),
  },
};

export default function Ornament({
  name = "fleuron",
  width,
  className,
  color = "var(--brass)",
}: {
  name?: OrnamentName;
  width?: number | string;
  className?: string;
  color?: string;
}) {
  const a = ART[name];
  return (
    <svg
      viewBox={a.box}
      width={width ?? "100%"}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      style={{ color, display: "block" }}
    >
      {a.d}
    </svg>
  );
}
