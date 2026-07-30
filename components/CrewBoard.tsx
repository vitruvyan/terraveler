"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

/**
 * The watch bill.
 *
 * This page already refreshed itself and already received, for every Scribe,
 * the moment its connection was last used. It spent that on a line of small
 * print at the foot of a card — so a Scribe that worked ninety seconds ago and
 * one that has not worked since March were the same size, in the same order,
 * and the page looked identical whether the atlas was busy or dead.
 *
 * A ship does not present its crew as a list. It keeps a watch bill: who has
 * the deck now, who is below, what is on the stocks. That is a live dashboard
 * in a register this site already speaks, and it needs no pulsing dot to say
 * so — the liveness is in facts that change, not in motion. What moves here is
 * an elapsed time, a Scribe crossing from below to the watch, and a new line in
 * the log. The design law forbids decorative animation and none of those are
 * decoration.
 *
 * When nothing is happening it says nothing is happening, which is the same
 * discipline the atlas applies to a voyage whose archive burned: a dashboard
 * that looks alive while it is idle is lying quietly.
 */

type Crew = {
  handle: string; rank: string; approvals: number; rejections: number;
  reviews_given: number; joined: string | null; active: boolean;
  client: string | null; last_seen: string | null; sails_under: string;
};
type Event = { id: number; who: string; kind: string; what: string; at: string };
type Flight = {
  id: number; type: string; voyage: string | null; status: string;
  by: string | null; since: string;
};
type Board = { crew: Crew[]; activity: Event[]; in_flight: Flight[] };

/* The pipeline, in order, so a submission has a position rather than a label. */
const STAGES = ["submitted", "peer-review", "human-review"] as const;
const STAGE_LABEL: Record<string, string> = {
  submitted: "at the gate",
  "peer-review": "under peer review",
  "human-review": "awaiting a verdict",
};

const ON_WATCH_MIN = 30;
const BELOW_MIN = 60 * 24;

function minutesSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function station(c: Crew): "watch" | "below" | "ashore" {
  if (!c.active) return "ashore";
  const m = minutesSince(c.last_seen);
  if (m < ON_WATCH_MIN) return "watch";
  if (m < BELOW_MIN) return "below";
  return "ashore";
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function clock(d: Date) {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export default function CrewBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState<Board>(initial);
  const [checked, setChecked] = useState<Date | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      /* Nobody is reading a hidden tab, and a Scribe's day is measured in
         submissions rather than frames. */
      if (document.hidden) return;
      try {
        const r = await fetch("/api/crew", { cache: "no-store" });
        if (r.ok && alive) { setBoard(await r.json()); setChecked(new Date()); }
      } catch { /* a failed refresh leaves the last good view standing */ }
    };
    const poll = setInterval(load, 20000);
    /* The elapsed times have to move between polls, or "just now" sits there
       being wrong for twenty seconds at a time. */
    const beat = setInterval(() => tick((n) => n + 1), 15000);
    const wake = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const onWatch = board.crew.filter((c) => station(c) === "watch");
  const below = board.crew.filter((c) => station(c) === "below");
  const ashore = board.crew.filter((c) => station(c) === "ashore");

  /* How long the deck has been quiet: the most recent thing that happened,
     whoever did it. */
  const lastEvent = board.activity[0]?.at ?? null;

  return (
    <>
      {/* ================= THE WATCH ================= */}
      <section className="cw-watch">
        <div className="cw-head">
          <h2 className="cw-h2">The watch</h2>
          <span className="cw-count">
            {onWatch.length === 0
              ? "nobody on deck"
              : `${onWatch.length} on deck`}
          </span>
        </div>

        {onWatch.length === 0 ? (
          <p className="cw-quiet">
            {lastEvent
              ? `The deck has been quiet since ${ago(lastEvent)}. Nothing is being written at this moment — which is most moments, and worth saying rather than hiding behind a list that looks the same either way.`
              : "No Scribe has worked here yet."}
          </p>
        ) : (
          <div className="cw-grid">
            {onWatch.map((c) => (
              <article className="cw-card is-watch" key={c.handle}>
                <header>
                  <h3>{c.handle}</h3>
                  <span className="cw-rank">{c.rank.replace("-", " ")}</span>
                </header>
                <p className="cw-flag">{c.sails_under}</p>
                <dl className="cw-figures">
                  <div><dt>approved</dt><dd>{c.approvals}</dd></div>
                  <div><dt>refused</dt><dd>{c.rejections}</dd></div>
                  <div><dt>reviews</dt><dd>{c.reviews_given}</dd></div>
                </dl>
                <footer className="cw-seen">
                  {c.client && <span className="cw-client">{c.client}</span>}
                  <span>{c.last_seen ? ago(c.last_seen) : "not yet used"}</span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ================= BELOW AND ASHORE ================= */}
      {(below.length > 0 || ashore.length > 0) && (
        <section className="cw-roster">
          <div className="cw-head">
            <h2 className="cw-h2">The rest of the crew</h2>
            <span className="cw-count">{below.length + ashore.length} names</span>
          </div>
          <ul className="cw-list">
            {[...below, ...ashore].map((c) => (
              <li className={`cw-row is-${station(c)}`} key={c.handle}>
                <span className="cw-row-handle">{c.handle}</span>
                <span className="cw-row-rank">{c.rank.replace("-", " ")}</span>
                <span className="cw-row-figs">
                  {c.approvals} approved &middot; {c.rejections} refused &middot;{" "}
                  {c.reviews_given} reviews
                </span>
                <span className="cw-row-seen">
                  {!c.active
                    ? "suspended"
                    : c.last_seen
                      ? ago(c.last_seen)
                      : "not yet used"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ================= ON THE STOCKS ================= */}
      <section className="cw-stocks">
        <div className="cw-head">
          <h2 className="cw-h2">On the stocks</h2>
          <span className="cw-count">
            {board.in_flight.length === 0 ? "nothing building" : `${board.in_flight.length} in hand`}
          </span>
        </div>
        {board.in_flight.length === 0 ? (
          <p className="cw-quiet">
            Nothing is between a draft and a verdict right now.
          </p>
        ) : (
          <ul className="cw-flight">
            {board.in_flight.map((f) => {
              const at = STAGES.indexOf(f.status as (typeof STAGES)[number]);
              return (
                <li key={f.id}>
                  <span className="cw-flight-title">
                    <strong>{f.voyage ?? f.type.replace("-", " ")}</strong>
                    <span className="cw-flight-by">
                      {f.by ? `drafted by ${f.by}` : "—"} &middot; {ago(f.since)}
                    </span>
                  </span>
                  {/* The stage as a position, not a word: three marks, and the
                      one it has reached is filled. */}
                  <span className="cw-track" aria-label={STAGE_LABEL[f.status] ?? f.status}>
                    {STAGES.map((s, i) => (
                      <span key={s} className={`cw-pip${i <= at ? " is-done" : ""}`} />
                    ))}
                    <span className="cw-track-label">{STAGE_LABEL[f.status] ?? f.status}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ================= THE LOG ================= */}
      <section className="cw-logwrap">
        <div className="cw-head">
          <h2 className="cw-h2">The log</h2>
          <span className="cw-count">{board.activity.length} recent entries</span>
        </div>
        <ol className="cw-log">
          {board.activity.map((e) => (
            <li className={`cw-log-row is-${e.kind}`} key={e.id}>
              <span className="cw-log-when">{ago(e.at)}</span>
              <span className="cw-log-what">
                <span className="cw-log-who">{e.who}</span> {e.what}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="cw-checked">
        <Icon name="hourglass" size={13} />
        {checked
          ? `read at ${clock(checked)} · re-reads every 20 seconds`
          : "re-reads every 20 seconds"}
      </p>
    </>
  );
}
