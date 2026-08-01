"use client";

import Icon from "@/components/Icon";
import type { RefObject } from "react";

/* The transport bar, once, with a lexicon.
 *
 * It was built twice — here in an Age-of-Sail vocabulary and again in a
 * telemetry one — and the debt list has been asking for this since 10916eb
 * closed the same wound on the imprint. The two copies were identical in
 * arrangement and differed only in what things are CALLED: a landfall or a
 * flyby, Off Brest or Near Neptune, the ship's timeline or the mission's. That
 * is a lexicon, not a design, so the design is here and the words arrive as a
 * prop.
 *
 * It matters more than tidiness. The Space copy has twice now drifted from
 * this one by being edited alone, and both times the loss was invisible: a
 * chip that never appeared, a menu that stayed stale. A phone makes it worse
 * again, because every fix below has to land in both places on the same day or
 * one atlas keeps a control no thumb can hit.
 */

export type Stop = {
  /** Whatever the subject keys its waypoints by — a React key, not an id we
      own, so it takes both rather than making two call sites cast. */
  id: string | number;
  /** When the ship or the probe got there. */
  at: number;
  /** What this voyage calls the place. */
  label: string;
};

export type TransportLexicon = {
  /** The scrubber's accessible name — "Voyage timeline", "Mission timeline". */
  timeline: string;
  /** What a stop is called here — "landfall", "flyby". */
  stop: string;
  /** The autopause label, which names the same thing a third time. */
  autopause: string;
};

export default function TransportBar({
  barRef,
  playing,
  onTogglePlay,
  dateLabel,
  placeLine,
  stops,
  t,
  min,
  max,
  step,
  onScrub,
  onOpenStop,
  autopause,
  onAutopause,
  lexicon,
  phone,
}: {
  barRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
  onTogglePlay: () => void;
  dateLabel: string;
  placeLine: string;
  stops: Stop[];
  t: number;
  min: number;
  max: number;
  step: number;
  onScrub: (t: number) => void;
  onOpenStop: (at: number) => void;
  autopause: boolean;
  onAutopause: (on: boolean) => void;
  lexicon: TransportLexicon;
  phone: boolean;
}) {
  const span = max > min ? max - min : 1;
  const pctOf = (time: number) =>
    Math.max(0, Math.min(100, ((time - min) / span) * 100));
  const pct = pctOf(t);

  /* Step to the next stop in either direction — what the 2px ticks were
     pretending to offer. A step of tolerance, because `t` lands on a stop
     exactly when a stepper put it there and a hair off it when the scrubber
     did, and without the margin a second press from a scrubbed position finds
     the stop it is already sitting on. Clamped rather than wrapping: a voyage
     has a first stop and a last one, and arriving back at the start by
     pressing "next" past the end would be a lie about the map. */
  const stepStop = (dir: 1 | -1) => {
    const at = stops.map((s) => s.at);
    const next =
      dir === 1 ? at.find((x) => x > t + step) : [...at].reverse().find((x) => x < t - step);
    onScrub(next ?? (dir === 1 ? max : min));
  };

  return (
    <div className="transport-bar" ref={barRef}>
      <button
        className="play-btn"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        <Icon name={playing ? "pause" : "play"} size={17} />
      </button>

      {/* What the ticks stopped being. Only on a phone: a mouse can hit 2px,
          and a second pair of buttons on a wide screen would be chrome bought
          for nothing. */}
      {phone && (
        <div className="vt-steps">
          <button
            className="vt-step"
            onClick={() => stepStop(-1)}
            aria-label={`Previous ${lexicon.stop}`}
          >
            <Icon name="stage-prev" size={18} />
          </button>
          <button
            className="vt-step"
            onClick={() => stepStop(1)}
            aria-label={`Next ${lexicon.stop}`}
          >
            <Icon name="stage-next" size={18} />
          </button>
        </div>
      )}

      <div className="tb-reading">
        <div className="tb-date">{dateLabel}</div>
        <div className="tb-place">{placeLine}</div>
      </div>

      <div className="voyage-track">
        {/* A TICK IS A MARK, NOT A DOOR — on a phone.

            Measured on a real engine: each is 2×8 and there are fifteen across
            a 340px rail. That is not a control anyone can hit, and no tap-size
            floor fixes it, because fifteen 44px targets do not fit in 340px at
            any size. So on a phone they stop claiming to be controls —
            printed marks, out of the tab order and out of the accessibility
            tree — and the precise navigation they were pretending to offer
            moves to the steppers above, which is how a voyage is read anyway:
            stop by stop, rather than by hitting two pixels for Batavia. */}
        <div className="vt-ticks">
          {stops.map((s) =>
            phone ? (
              <span
                key={s.id}
                className="vt-tick"
                style={{ left: `${pctOf(s.at)}%` }}
                aria-hidden="true"
              />
            ) : (
              <button
                key={s.id}
                className="vt-tick"
                style={{ left: `${pctOf(s.at)}%` }}
                title={s.label}
                aria-label={s.label}
                onClick={() => onOpenStop(s.at)}
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

      <label className="autopause-toggle">
        <input
          type="checkbox"
          checked={autopause}
          onChange={(e) => onAutopause(e.target.checked)}
        />
        {lexicon.autopause}
      </label>
    </div>
  );
}
