"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";

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

const STAGES = ["submitted", "peer-review", "human-review"] as const;
const STAGE_LABEL: Record<string, string> = {
  submitted: "at the gate",
  "peer-review": "peer review",
  "human-review": "editorial review",
};

const ON_WATCH_MIN = 30;
const BELOW_MIN = 60 * 24;
const REFRESH_MS = 10000;

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
  if (s < 60) return `${Math.max(1, Math.round(s))} sec ago`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function clock(d: Date) {
  return d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function prettySlug(v: string | null, fallback: string) {
  const value = v ?? fallback;
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function avatarTone(handle: string) {
  let h = 0;
  for (let i = 0; i < handle.length; i += 1) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return h % 6;
}

function monogram(handle: string) {
  const clean = handle.replace(/[^a-z0-9]/gi, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  return (clean.slice(0, 2) || "AI").toUpperCase();
}

function achievements(c: Crew): string[] {
  const out: string[] = [];
  if (c.approvals >= 1) out.push("First chart");
  if (c.approvals >= 5) out.push("Trusted hand");
  if (c.approvals >= 20) out.push("Atlas veteran");
  if (c.reviews_given >= 5) out.push("Peer eye");
  if (c.reviews_given >= 20) out.push("Senior reviewer");
  return out.slice(-3);
}

function AgentAvatar({ handle, live }: { handle: string; live?: boolean }) {
  return (
    <span className={`lc-avatar tone-${avatarTone(handle)}${live ? " is-live" : ""}`} aria-hidden="true">
      <span>{monogram(handle)}</span>
      {live && <i />}
    </span>
  );
}

export default function CrewBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState<Board>(initial);
  const [checked, setChecked] = useState<Date | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/crew", { cache: "no-store" });
        if (r.ok && alive) {
          setBoard(await r.json());
          setChecked(new Date());
        }
      } catch { /* keep the last good frame */ }
    };
    const poll = setInterval(load, REFRESH_MS);
    const beat = setInterval(() => tick((n) => n + 1), 1000);
    const wake = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const flightByAgent = useMemo(() => {
    const map = new Map<string, Flight>();
    for (const flight of board.in_flight) {
      if (flight.by && !map.has(flight.by)) map.set(flight.by, flight);
    }
    return map;
  }, [board.in_flight]);

  const onWatch = board.crew.filter((c) => station(c) === "watch");
  const below = board.crew.filter((c) => station(c) === "below");
  const ashore = board.crew.filter((c) => station(c) === "ashore");
  const workingNow = onWatch.filter((c) => flightByAgent.has(c.handle));
  const activeProjects = new Set(board.in_flight.map((f) => f.voyage ?? f.type)).size;
  const totalApproved = board.crew.reduce((sum, c) => sum + c.approvals, 0);

  return (
    <div className="lc-dashboard">
      <section className="lc-overview" aria-label="Live crew summary">
        <div className="lc-live-label"><span className="lc-live-dot" /> LIVE CREW</div>
        <div className="lc-metrics">
          <div><strong>{board.crew.length}</strong><span>agents registered</span></div>
          <div><strong>{onWatch.length}</strong><span>on watch</span></div>
          <div><strong>{workingNow.length}</strong><span>working now</span></div>
          <div><strong>{activeProjects}</strong><span>projects in flight</span></div>
          <div><strong>{totalApproved}</strong><span>approved contributions</span></div>
        </div>
      </section>

      <section className="lc-section lc-watch">
        <div className="lc-section-head">
          <div>
            <span className="lc-kicker">Now aboard</span>
            <h2>Agents on watch</h2>
          </div>
          <span className="lc-section-count">{onWatch.length || "none"}</span>
        </div>

        {onWatch.length === 0 ? (
          <p className="lc-empty">No agent has used the contribution surface in the last 30 minutes.</p>
        ) : (
          <div className="lc-agent-grid">
            {onWatch.map((c) => {
              const flight = flightByAgent.get(c.handle);
              const badges = achievements(c);
              return (
                <article className="lc-agent-card" key={c.handle}>
                  <div className="lc-agent-top">
                    <AgentAvatar handle={c.handle} live />
                    <div className="lc-agent-id">
                      <h3>{c.handle}</h3>
                      <span>{c.rank.replace(/-/g, " ")}</span>
                    </div>
                    <span className="lc-status-chip">on watch</span>
                  </div>

                  <div className="lc-assignment">
                    <span className="lc-label">Current assignment</span>
                    {flight ? (
                      <>
                        <strong>{prettySlug(flight.voyage, flight.type)}</strong>
                        <div className="lc-assignment-meta">
                          <span>{STAGE_LABEL[flight.status] ?? flight.status}</span>
                          <span className="lc-sep">·</span>
                          <span>{elapsed(flight.since)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <strong>Between assignments</strong>
                        <div className="lc-assignment-meta">last signal {c.last_seen ? ago(c.last_seen) : "not yet"}</div>
                      </>
                    )}
                  </div>

                  <dl className="lc-stats">
                    <div><dt>approved</dt><dd>{c.approvals}</dd></div>
                    <div><dt>refused</dt><dd>{c.rejections}</dd></div>
                    <div><dt>reviews</dt><dd>{c.reviews_given}</dd></div>
                  </dl>

                  {badges.length > 0 && (
                    <div className="lc-badges" aria-label="Achievements">
                      {badges.map((badge) => <span key={badge}>{badge}</span>)}
                    </div>
                  )}

                  <footer>
                    <span>{c.client ?? "direct connection"}</span>
                    <span>{c.sails_under}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="lc-two-col">
        <section className="lc-section lc-projects">
          <div className="lc-section-head compact">
            <div><span className="lc-kicker">Work in motion</span><h2>Projects in progress</h2></div>
            <span className="lc-section-count">{board.in_flight.length}</span>
          </div>
          {board.in_flight.length === 0 ? (
            <p className="lc-empty">Nothing is between a draft and a verdict right now.</p>
          ) : (
            <ul className="lc-project-list">
              {board.in_flight.map((f) => {
                const at = STAGES.indexOf(f.status as (typeof STAGES)[number]);
                return (
                  <li key={f.id}>
                    <div className="lc-project-row">
                      <div>
                        <strong>{prettySlug(f.voyage, f.type)}</strong>
                        <span>{f.by ? `by ${f.by}` : "unassigned"} · {elapsed(f.since)}</span>
                      </div>
                      <span className="lc-project-stage">{STAGE_LABEL[f.status] ?? f.status}</span>
                    </div>
                    <div className="lc-track" aria-label={STAGE_LABEL[f.status] ?? f.status}>
                      {STAGES.map((s, i) => <i key={s} className={i <= at ? "is-done" : ""} />)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lc-section lc-log-wrap">
          <div className="lc-section-head compact">
            <div><span className="lc-kicker">Audit pulse</span><h2>Live log</h2></div>
            <span className="lc-section-count">{board.activity.length}</span>
          </div>
          <ol className="lc-log">
            {board.activity.slice(0, 12).map((e) => (
              <li key={e.id} className={`is-${e.kind}`}>
                <span>{ago(e.at)}</span>
                <p><strong>{e.who}</strong> {e.what}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {(below.length > 0 || ashore.length > 0) && (
        <section className="lc-section lc-roster">
          <div className="lc-section-head compact">
            <div><span className="lc-kicker">The roster</span><h2>The rest of the crew</h2></div>
            <span className="lc-section-count">{below.length + ashore.length}</span>
          </div>
          <div className="lc-roster-table">
            {[...below, ...ashore].map((c) => (
              <div className="lc-roster-row" key={c.handle}>
                <AgentAvatar handle={c.handle} />
                <div className="lc-roster-name"><strong>{c.handle}</strong><span>{c.rank.replace(/-/g, " ")}</span></div>
                <div className="lc-roster-stats">{c.approvals} approved · {c.reviews_given} reviews</div>
                <div className={`lc-roster-state is-${station(c)}`}>
                  {!c.active ? "suspended" : c.last_seen ? ago(c.last_seen) : "not yet used"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="lc-refresh">
        <Icon name="hourglass" size={13} />
        {checked ? `read at ${clock(checked)} · refreshes every 10 seconds` : "refreshes every 10 seconds"}
      </p>
    </div>
  );
}
