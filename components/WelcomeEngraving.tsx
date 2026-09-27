/* The engraved ornament of the homepage invitation.
 *
 * The invitation is a printed title-plate, so its decoration belongs to an
 * engraver rather than a decorator: hairline ink on parchment, drawn rather
 * than typed. Every piece here replaces a glyph the first version borrowed
 * from the emoji table — the icon law already forbids those, and the defect
 * was worse here than anywhere else on the site, because six borrowed glyphs
 * were the entire ornament of the page a newcomer sees first. What a reader
 * saw depended on whether they were on Apple, Google or Microsoft, and on a
 * machine with no emoji font the corners of the invitation were four tofu
 * boxes.
 *
 * Each piece keeps its OWN viewBox and is placed by CSS. One wide SVG drawn
 * across the whole plate would be the obvious build and it is wrong: the plate
 * is 16:9 on a desktop and nearly square on a phone, so a compass rose inside
 * it would stop being a circle the moment the viewport changed. Nothing here
 * is ever asked to stretch.
 *
 * Stroke only, currentColor, no fill — the same rules as components/Icon.tsx,
 * for the same reason: the colour is the caller's to decide, and a filled
 * shape at this scale turns to porridge. They are marks, not words, so they
 * are aria-hidden and carry no meaning a screen reader loses.
 */

type Piece = { className?: string };

const ENGRAVED = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.15,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/* ---------------------------------------------------------------------------
   The compass rose. It is the corner medallion, the crest at the foot of the
   frame and the mark standing in the eastern ocean — one drawing at three
   sizes, because a plate that used three different roses would be asserting a
   distinction it does not have. */
export function CompassRose({ className }: Piece) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" {...ENGRAVED}>
      <circle cx="32" cy="32" r="29.5" />
      <circle cx="32" cy="32" r="24" strokeWidth={0.8} />
      {/* the diagonal points, shorter, drawn first so the cardinals sit over them */}
      <path
        transform="rotate(45 32 32)"
        d="M32 14 33.4 30.6 50 32 33.4 33.4 32 50 30.6 33.4 14 32 30.6 30.6Z"
        strokeWidth={0.9}
      />
      <path d="M32 6 34.4 29.6 58 32 34.4 34.4 32 58 29.6 34.4 6 32 29.6 29.6Z" />
      <circle cx="32" cy="32" r="3.4" strokeWidth={0.9} />
    </svg>
  );
}

/* The fleuron that breaks the head of the frame. A printer's lily: the sober
   end of what the reference sheets offer, per the ornament rule. */
export function Fleuron({ className }: Piece) {
  return (
    <svg className={className} viewBox="0 0 44 52" aria-hidden="true" {...ENGRAVED}>
      <path d="M22 5c-4.2 7.4-4.2 16.6 0 24 4.2-7.4 4.2-16.6 0-24Z" />
      <path d="M22 27c-5.6.6-10.8-2.2-12.4-8.2-3.4 4-3.2 11 1.4 13.6 3.2 1.8 8 .8 11-3.2" />
      <path d="M22 27c5.6.6 10.8-2.2 12.4-8.2 3.4 4 3.2 11-1.4 13.6-3.2 1.8-8 .8-11-3.2" />
      <path d="M11 33.5h22" />
      <path d="M22 33.5v11" />
      <path d="M22 44.5c-3 0-5.2-1.6-5.6-4.2M22 44.5c3 0 5.2-1.6 5.6-4.2" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   The two wind-heads. A putto in a cloud with its cheek full, which is how a
   sixteenth-century chart says "wind" without a legend. The NE one is the same
   drawing mirrored — a second, hand-drawn variant would drift from the first
   and nobody would be able to say which of the two was right.

   Anything marked eng-paper is a solid body: the stylesheet fills it with the
   plate's own paper so that what is behind it is hidden rather than showing
   through. Without it a cloud reads through a cherub's face and a wave runs
   straight through a hull, which is what the first cut of this file did. */
export function WindHead({ className }: Piece) {
  return (
    <svg className={className} viewBox="0 0 132 98" aria-hidden="true" {...ENGRAVED}>
      {/* the cloud it rides in */}
      <path
        className="eng-paper"
        d="M15 90C5 90 1 80 10 75 5 64 16 56 26 60 30 49 49 47 55 57c10-6 24 1 23 11 9 3 9 17-2 19-4 6-16 8-24 3-10 6-30 5-37 1Z"
      />
      <path d="M23 82c5 3 12 3 17-1" strokeWidth={0.7} />
      <path d="M58 84c5 2 11 1 15-2" strokeWidth={0.7} />
      {/* the head, sitting on the cloud rather than inside it */}
      <path className="eng-paper" d="M45 18c10 0 17 8 17 18s-7 18-17 18-17-8-17-18 7-18 17-18Z" />
      {/* hair: scallops along the crown, not three rings */}
      <path d="M30 31c-3-4 1-9 5-7M38 22c-2-5 4-8 7-4M49 19c2-4 8-3 8 2M58 26c3-3 7 0 6 5" strokeWidth={0.8} />
      {/* brow, eye shut against its own effort, nose */}
      <path d="M44 30c2-1.6 5-1.4 7 .6" strokeWidth={0.8} />
      <path d="M45 35c2-1.6 4.5-1.4 6 .4" strokeWidth={0.8} />
      <path d="M55 32c3 2.2 3 4.4.5 5.4" strokeWidth={0.8} />
      {/* the full cheek, and the mouth it is pushing the wind through */}
      <path d="M53 41c7-1 10.5 5 6 8.4-3.5 2.6-8 0-8-4.4" />
      <circle className="eng-paper" cx="59.5" cy="43.5" r="2.5" strokeWidth={0.9} />
      {/* the wind itself, in three breaths */}
      <path d="M63 40c16-8 32-4 51-13" strokeWidth={0.9} />
      <path d="M63 45c17-2 33 3 52-3" strokeWidth={0.9} />
      <path d="M62 49c16 7 31 9 47 17" strokeWidth={0.9} />
      <path d="M114 27c5-2.6 7-6.4 4-9M116 42c5.4 0 8-2.6 7.6-6.4M109 66c5 2.2 8.6 1 9.6-2.6" strokeWidth={0.7} />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   The ship. A carrack under full sail — the vessel the atlas opens on, since
   the first circumnavigation is the voyage behind the door this plate stands
   in front of.

   The order of the parts is the order an engraver would cut them, and it is
   load-bearing: the sea first so the hull stands IN it, the masts before the
   sails so a sail hides the mast it is bent to, the stays before the sails for
   the same reason, and the tops last because they are in front of everything. */
export function Carrack({ className }: Piece) {
  return (
    <svg className={className} viewBox="0 0 184 148" aria-hidden="true" {...ENGRAVED}>
      {/* the sea behind her */}
      <path
        d="M0 100q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.75}
      />
      {/* hull: a flat run amidships with the ends rising, not a crescent */}
      <path className="eng-paper" d="M16 76c36 16 114 16 150-4l-4 20c-4 14-16 20-30 20H52c-14 0-26-6-30-20Z" />
      <path d="M24 92c14 10 122 10 136-2" strokeWidth={0.7} />
      {/* forecastle, and the stern castle that carries the lantern deck */}
      <path className="eng-paper" d="M18 78 16 64c6-3 14-3 18 0l1 18Z" />
      <path d="M18 70c5-2 11-2 15-1" strokeWidth={0.6} />
      <path className="eng-paper" d="M138 84c4-20 12-32 24-34 10-2 16 2 16 8l-4 28Z" />
      <path d="M150 66c8-6 18-7 26-5M145 74c9-6 21-7 31-5" strokeWidth={0.6} />
      <path d="M164 56v7M170 56v7" strokeWidth={0.5} />
      {/* bowsprit and its spritsail */}
      <path d="M18 70 0 50" />
      <path className="eng-paper" d="M3 61l10-4 2 7-10 4Z" strokeWidth={0.8} />
      {/* masts and standing rigging, then the canvas that hides both */}
      <path d="M52 86V22M96 87V4M134 85V38" />
      <path d="M96 6 18 70M96 6l66 64" strokeWidth={0.5} />
      <path className="eng-paper" d="M32 54h40l-2 20c-5 5-12 7-18 7s-13-2-18-7Z" />
      <path className="eng-paper" d="M40 28h24l-1 14c-4 4-9 5-11 5s-7-1-11-5Z" strokeWidth={0.95} />
      <path className="eng-paper" d="M72 50h48l-2 24c-6 6-14 8-22 8s-16-2-22-8Z" />
      <path className="eng-paper" d="M80 22h32l-2 18c-5 5-10 6-14 6s-9-1-14-6Z" strokeWidth={0.95} />
      <path className="eng-paper" d="M88 6h16l-1 10c-3 3-5 4-7 4s-4-1-7-4Z" strokeWidth={0.85} />
      <path d="M30 54h44M38 28h28M70 50h52M78 22h36M86 6h20" strokeWidth={0.8} />
      {/* the lateen mizzen, which is what dates her */}
      <path d="M120 90 156 38" strokeWidth={0.8} />
      <path className="eng-paper" d="M134 46l16 34h-26Z" />
      {/* the tops, in front of the canvas: a platform is wide at the top */}
      <path className="eng-paper" d="M87 44h18l-4 6H91Z" strokeWidth={0.85} />
      <path className="eng-paper" d="M44 47h16l-3 5H47Z" strokeWidth={0.85} />
      {/* pennants */}
      <path d="M96 4l16 4-16 4" strokeWidth={0.8} />
      <path d="M52 22l12 3-12 3M134 38l10 3-10 3" strokeWidth={0.7} />
      {/* and the sea in front of her, which is what seats her in it */}
      <path
        d="M0 112q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.85}
      />
      <path
        d="M6 126q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.7}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   The serpent. Every chart this plate is imitating put one in the empty ocean,
   and the empty ocean is exactly what the right-hand gutter of this modal is.

   Its coils are bands with two edges rather than single arcs. Drawn as arcs
   they read as croquet hoops: a line has no body, and a serpent is all body. */
export function SeaSerpent({ className }: Piece) {
  return (
    <svg className={className} viewBox="0 0 180 132" aria-hidden="true" {...ENGRAVED}>
      <path
        d="M0 98q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.75}
      />
      {/* the tail fluke, and the coils that break the surface */}
      <path className="eng-paper" d="M6 106c2-14 10-24 22-28-8 8-12 18-11 28Z" />
      <path className="eng-paper" d="M22 106c0-28 28-28 28 0H40c0-18-8-18-8 0Z" />
      <path className="eng-paper" d="M60 106c0-36 34-36 34 0H83c0-24-12-24-12 0Z" />
      {/* the neck, tapering as it rises */}
      <path className="eng-paper" d="M100 106c0-32 8-58 24-72l13 11c-12 12-23 35-24 61Z" />
      {/* the head: a wedge, jaws open */}
      <path className="eng-paper" d="M124 34c2-14 16-22 30-19 9 2 14 8 14 12l-24 13Z" />
      <path className="eng-paper" d="M137 45c4 7 14 12 26 11 5-1 6-5 2-7l-21-8Z" />
      <path d="M147 40l1 5M154 39l2 5M160 44l-2-4" strokeWidth={0.55} />
      <circle cx="140" cy="28" r="1.9" strokeWidth={0.85} />
      <path d="M129 20 125 10M139 15l-1-10" strokeWidth={0.7} />
      {/* the crest along the neck, and the spines on the coils */}
      <path d="M103 94 95 90M105 82 97 77M109 70l-8-5M114 58l-7-6" strokeWidth={0.7} />
      <path d="M28 88l-2-8M36 82v-8M44 88l3-8M66 84l-3-8M77 76v-8M88 84l3-8" strokeWidth={0.7} />
      {/* hatching, so the coils have a body rather than an outline */}
      <path d="M26 98c4-4 10-4 13 0M31 90c3-3 6-3 9 0M67 96c4-5 11-5 15 0M72 86c3-3 7-3 10 0" strokeWidth={0.5} />
      <path d="M104 88c4-2 8-1 11 1M108 74c4-2 7-1 10 1" strokeWidth={0.5} />
      {/* one fin, to say it swims */}
      <path className="eng-paper" d="M110 98c8-9 20-10 27-4-9 0-18 3-23 8Z" strokeWidth={0.85} />
      {/* the sea in front, which is what puts the coils IN the water */}
      <path
        d="M0 108q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.85}
      />
      <path
        d="M6 122q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0q7-6 14 0t14 0"
        strokeWidth={0.7}
      />
    </svg>
  );
}
