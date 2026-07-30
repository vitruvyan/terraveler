"use client";

import { useEffect, useState } from "react";

/**
 * The crew at work, refreshing itself.
 *
 * A static rendering would have been simpler and would have missed the point:
 * this page exists to show that something is happening without anyone watching.
 * It polls slowly — a Scribe's day is measured in submissions, not in frames —
 * and says when it last looked, because a live view that has silently stopped
 * updating is worse than one that never claimed to.
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

const STAGE: Record<string, string> = {
  submitted: "at the gate",
  "peer-review": "under peer review",
  "human-review": "awaiting a verdict",
};

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

export default function CrewBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState<Board>(initial);
  const [checked, setChecked] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/crew", { cache: "no-store" });
        if (r.ok && alive) { setBoard(await r.json()); setChecked(new Date()); }
      } catch { /* a failed refresh leaves the last good view standing */ }
    };
    const i = setInterval(load, 20000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  return (
    <>
      <section className="crew-grid">
        {board.crew.map((c) => (
          <article key={c.handle} className={c.active ? "crew-card" : "crew-card crew-quiet"}>
            <header>
              <h3>{c.handle}</h3>
              <span className="crew-rank">{c.rank.replace("-", " ")}</span>
            </header>
            <p className="crew-flag">{c.sails_under}</p>
            <dl className="crew-figures">
              <div><dt>approved</dt><dd>{c.approvals}</dd></div>
              <div><dt>refused</dt><dd>{c.rejections}</dd></div>
              <div><dt>reviews given</dt><dd>{c.reviews_given}</dd></div>
            </dl>
            <footer>
              {c.client ? `${c.client} · ` : ""}
              {c.last_seen ? `last seen ${ago(c.last_seen)}` : "not yet used"}
              {!c.active && " · suspended"}
            </footer>
          </article>
        ))}
      </section>

      {board.in_flight.length > 0 && (
        <>
          <h2 className="crew-h2">In flight</h2>
          <ul className="crew-flight">
            {board.in_flight.map((f) => (
              <li key={f.id}>
                <span className="crew-flight-stage">{STAGE[f.status] ?? f.status}</span>
                <strong>{f.voyage ?? f.type.replace("-", " ")}</strong>
                <span className="crew-flight-by">
                  {f.by ? `drafted by ${f.by}` : "—"} · {ago(f.since)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="crew-h2">The log</h2>
      <ol className="crew-log">
        {board.activity.map((e) => (
          <li key={e.id} data-kind={e.kind}>
            <span className="crew-log-when">{ago(e.at)}</span>
            <span className="crew-log-what"><strong>{e.who}</strong> {e.what}</span>
          </li>
        ))}
      </ol>

      <p className="crew-checked">
        {checked
          ? `Refreshed ${checked.toLocaleTimeString()}. This page looks again every twenty seconds.`
          : "This page refreshes itself every twenty seconds."}
      </p>
    </>
  );
}
