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
        /* One mark, not a strip of tabs. Two labelled tabs cost the width of
           both words permanently to show a choice you make rarely — the same
           argument that collapsed MapLibre's attribution to its (i).

           The law's objection to a bare toggle is that an unlabelled control
           has to be taught, and it is answered rather than ignored: the
           caption line beside this button ALWAYS names what the rail is
           showing, so the words never left the bar, they only stopped being
           printed twice. The hourglass is "meanwhile" — what else was
           happening while the ship was here — and it is the one icon in the
           set about simultaneity rather than about a place. */
        <button
          className={`tb-track-btn${shown?.key !== tracks[0].key ? " on" : ""}`}
          aria-pressed={shown?.key !== tracks[0].key}
          aria-label={
            shown?.key === tracks[0].key
              ? `Show ${tracks[1].tab.toLowerCase()} on the timeline`
              : `Back to the ${tracks[0].tab.toLowerCase()} timeline`
          }
          onClick={() =>
            onTrack(shown?.key === tracks[0].key ? tracks[1].key : tracks[0].key)
          }
        >
          <Icon name="hourglass" size={18} />
        </button>
      )}

      <div className="voyage-track">
        {/* A MARK IS NOT A DOOR — on a phone.

            Measured: each of these is 2×8 and there are fifteen across a 340px
            rail. No tap floor fixes that, because fifteen 44px targets do not
            fit in 340px at any size. So on a phone they are printed marks, out
            of the tab order and out of the accessibility tree, and stepping
            between them moved into the log — where you are already reading the
            thing they point at. A mouse can hit 2px, so a wide screen keeps
            them as buttons. */}
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
        {phone && shown?.segmented && shown.marks.length > 1 && (
          <div className="vt-segs" aria-hidden="true">
            {shown.marks.slice(0, -1).map((m, i) => {
              const from = pctOf(m.at);
              const to = pctOf(shown.marks[i + 1].at);
              const span = to - from || 0.001;
              const done = Math.max(0, Math.min(100, ((pct - from) / span) * 100));
              return (
                <span
                  key={m.id}
                  className={`vt-seg tone-${i % 4}`}
                  style={{ left: `${from}%`, width: `${to - from}%` }}
                >
                  <span className="vt-seg-fill" style={{ width: `${done}%` }} />
                </span>
              );
            })}
          </div>
        )}
        <div className="vt-ticks">
          {(phone && shown?.segmented ? [] : shown?.marks ?? []).map((m) =>
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
