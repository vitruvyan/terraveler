"use client";

import Icon from "@/components/Icon";
import type { RefObject } from "react";

/* The transport bar, once, with a lexicon — and on a phone, with almost
 * nothing left on it.
 *
 * It was built twice, in an Age-of-Sail vocabulary and a telemetry one,
 * identical in arrangement and different only in what things are CALLED: a
 * landfall or a flyby, Off Brest or Near Neptune. That is a lexicon, not a
 * design, so the design is here and the words arrive as props. The Space copy
 * has twice drifted by being edited alone, and both times the loss was
 * invisible — a chip that never appeared, a menu that stayed stale.
 *
 * WHAT A PHONE GETS, AND WHY IT IS SO LITTLE. Measured at 412×883 on the
 * owner's own handset, this bar was 165px — 17.6% of the screen — on a page
 * that gave the voyage itself about a tenth. Three things were on it that are
 * not transport:
 *
 *   the autopause checkbox   a SETTING, and a whole row to say a thing you
 *                            decide once. It becomes the behaviour instead: on
 *                            a phone the voyage always stops at a landfall and
 *                            opens the log, and the log carries the button
 *                            that sails on. A control in context beats a
 *                            preference in the abstract — and it is why the
 *                            row can GO rather than be hidden, which was tried
 *                            once and left a naked checkbox nobody could read.
 *   the stage steppers       they belong beside the thing they step through,
 *                            which is the log, not the map.
 *   the world strip          a second timeline, at the far end of the screen,
 *                            encoding the SAME axis. On a phone it arrives
 *                            here as a second track behind a switch.
 *
 * What is left is a caption, a switch and a rail — plus the play button, which
 * stays because it is the only way to begin: at first paint no log is open, so
 * a bar without it is a voyage that cannot be started.
 */

export type Mark = {
  /** Whatever the subject keys its waypoints by — a React key, not an id we
      own, so it takes both rather than making two call sites cast. */
  id: string | number;
  /** Where it sits on the shared time axis. */
  at: number;
  label: string;
  /** The category class the world's marks carry; a voyage's stops have none. */
  className?: string;
};

export type Track = {
  key: string;
  /** What the switch calls it. Two words at most: it is a tab, not a sentence. */
  tab: string;
  /** The line under the date while this track shows — the caption of whatever
      the rail is currently about. */
  caption: string;
  marks: Mark[];
  /** Where a mark leads on a wide screen, where 2px is a reachable target. */
  onMark?: (at: number) => void;
  /** True where consecutive marks bound a LEG — the passage from one stop to
      the next — so the rail can be drawn as a chain that fills. False for the
      world's events, which are moments rather than the ends of anything. */
  segmented?: boolean;
};

export type TransportLexicon = {
  /** The scrubber's accessible name — "Voyage timeline", "Mission timeline". */
  timeline: string;
  /** The autopause label. Wide only; a phone does not ask. */
  autopause: string;
};

export default function TransportBar({
  barRef,
  playing,
  onTogglePlay,
  dateLabel,
  tracks,
  activeTrack,
  onTrack,
  t,
  min,
  max,
  step,
  onScrub,
  autopause,
  onAutopause,
  lexicon,
  phone,
}: {
  barRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
  onTogglePlay: () => void;
  dateLabel: string;
  /** The first is the subject's own timeline; the rest are context, and only
      reach this bar on a phone — on a wide screen they have room of their own
      elsewhere and are drawn there. */
  tracks: Track[];
  activeTrack: string;
  onTrack: (key: string) => void;
  t: number;
  min: number;
  max: number;
  step: number;
  onScrub: (t: number) => void;
  autopause: boolean;
  onAutopause: (on: boolean) => void;
  lexicon: TransportLexicon;
  phone: boolean;
}) {
  const span = max > min ? max - min : 1;
  const pctOf = (time: number) => Math.max(0, Math.min(100, ((time - min) / span) * 100));
  const pct = pctOf(t);

  const shown = tracks.find((x) => x.key === activeTrack) ?? tracks[0];
  /* A switch with one choice is not a switch. */
  const switchable = phone && tracks.length > 1;
  /* Whether the chain of legs is drawing the position. Where it is, the range
     input stops drawing it too — a brass fill under a chain that already fills
     is the same sentence printed twice, which is the argument that took the
     thumb off the phone. The thumb itself stays on a wide screen: there it is
     not a second reading, it is the thing the hand grabs. */
  const chained = !!shown?.segmented && shown.marks.length > 1;

  return (
    <div className="transport-bar" ref={barRef}>
      <button className="play-btn" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
        <Icon name={playing ? "pause" : "play"} size={17} />
      </button>

      <div className="tb-reading">
        <div className="tb-date">{dateLabel}</div>
        <div className="tb-place">{shown?.caption}</div>
      </div>

      {switchable && (
        /* THE WORDS COME BACK. This was one hourglass for a while, on the
           argument that the caption beside it already named the active track
           so the label was printed twice. The argument was wrong in the only
           way that counts: the person using it said "ora è una clessidra ma
           non capisco". A control that has to be taught is the defect this
           repo's law names by name, and an unlabelled toggle was exactly one —
           I had reasoned my way past the rule instead of applying it.
           Two tabs, and they cost 2px of bar height. That was the whole
           saving. */
        <div className="tb-tracks" role="tablist" aria-label="Which timeline">
          {tracks.map((tr) => (
            <button
              key={tr.key}
              role="tab"
              aria-selected={tr.key === shown?.key}
              className={`tb-track-tab${tr.key === shown?.key ? " on" : ""}`}
              onClick={() => onTrack(tr.key)}
            >
              {tr.tab}
            </button>
          ))}
        </div>
      )}

      <div className={`voyage-track${chained ? " chained" : ""}`}>
        {/* A MARK IS NOT A DOOR — on a phone.

            Measured: each of these is 2×8 and there are fifteen across a 340px
            rail. No tap floor fixes that, because fifteen 44px targets do not
            fit in 340px at any size. So on a phone they are printed marks, out
            of the tab order and out of the accessibility tree, and stepping
            between them moved into the log — where you are already reading the
            thing they point at.
            A wide screen kept them as buttons on the grounds that a mouse can
            hit 2px. It can; it should not have to. Where the chain draws the
            rail the doors move ONTO it, and this row is left to the world's
            marks — which are moments, not the ends of anything, so they cannot
            be a chain. */}
        {/* THE RAIL AS A CHAIN OF LEGS, on a phone.

            The thumb is gone, and it is not hidden — it is redundant. Once each
            leg fills as the ship crosses it, the boundary between filled and
            unfilled IS the position, so a dot marking the same thing a second
            time was 18px of chrome saying what the bar already said.

            The legs cycle through four tones rather than carrying fifteen
            distinct ones. Fifteen colours would assert fifteen KINDS, and a
            voyage's legs do not differ in kind — they differ in order. Four
            repeating tones give a reader adjacent legs they can tell apart,
            which is the whole job, without the rail claiming a taxonomy the
            voyage does not have. */}
        {/* THE CHAIN IS NOT A PHONE AFFORDANCE — it is the drawing.
            It was built here because a phone had no room for a thumb, and it
            turned out to be the better picture of a voyage on any screen. A
            wide rail was a plain brass fill: it said how far through the TIME
            you were and nothing at all about the legs the time is made of,
            which on a map whose subject is the passage between two places is
            the wrong half to draw. So the chain draws on both, and everything
            that used to be said twice underneath it stops — the tick row goes
            `:empty` and collapses, the range input gives up its fill and keeps
            only the thumb a hand needs to grab.

            A LEG IS A DOOR, on a wide screen, and it leads to the far end.
            Two directions were possible and only one keeps every landfall
            reachable: with N stops there are N−1 legs, so pointing each at
            where it STARTS would strand the last landfall — the end of the
            voyage, the one a reader is most likely to want to jump to — with
            no leg after it to click. Pointing at where it ARRIVES strands the
            FIRST stop instead, which costs nothing: every voyage opens there.
            It also matches what the drawing already says. The leg fills as the
            ship crosses it, so clicking one means "cross this leg", and you
            are put down at the far end with it drawn full behind you. */}
        {chained && shown && (
          <div className="vt-segs" aria-hidden={phone ? "true" : undefined}>
            {shown.marks.slice(0, -1).map((m, i) => {
              const next = shown.marks[i + 1];
              const from = pctOf(m.at);
              const to = pctOf(next.at);
              const span = to - from || 0.001;
              const done = Math.max(0, Math.min(100, ((pct - from) / span) * 100));
              const cls = `vt-seg tone-${i % 4}`;
              const box = { left: `${from}%`, width: `${to - from}%` };
              const fill = <span className="vt-seg-fill" style={{ width: `${done}%` }} />;
              const leg = `${m.label} → ${next.label}`;
              return phone || !shown.onMark ? (
                <span key={m.id} className={cls} style={box}>
                  {fill}
                </span>
              ) : (
                <button
                  key={m.id}
                  type="button"
                  className={cls}
                  style={box}
                  title={leg}
                  aria-label={leg}
                  onClick={() => shown.onMark!(next.at)}
                >
                  {fill}
                </button>
              );
            })}
          </div>
        )}
        <div className="vt-ticks">
          {(chained ? [] : shown?.marks ?? []).map((m) =>
            phone || !shown?.onMark ? (
              <span
                key={m.id}
                className={`vt-tick${m.className ? ` ${m.className}` : ""}`}
                style={{ left: `${pctOf(m.at)}%` }}
                aria-hidden="true"
              />
            ) : (
              <button
                key={m.id}
                className={`vt-tick${m.className ? ` ${m.className}` : ""}`}
                style={{ left: `${pctOf(m.at)}%` }}
                title={m.label}
                aria-label={m.label}
                onClick={() => shown.onMark!(m.at)}
              />
            ),
          )}
        </div>
        <input
          type="range"
          className="scrubber"
          min={min}
          max={max}
          step={step}
          value={t}
          onChange={(e) => onScrub(Number(e.target.value))}
          style={{ width: "100%", backgroundSize: `${pct}% 100%` }}
          aria-label={lexicon.timeline}
        />
      </div>

      {/* The setting exists only where there is room to explain it. On a phone
          the behaviour is the default and the log's own button is the control,
          so there is nothing here to hide and nothing to teach. */}
      {!phone && (
        <label className="autopause-toggle">
          <input
            type="checkbox"
            checked={autopause}
            onChange={(e) => onAutopause(e.target.checked)}
          />
          {lexicon.autopause}
        </label>
      )}
    </div>
  );
}
