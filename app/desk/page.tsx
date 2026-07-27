"use client";

import { useEffect, useState } from "react";
import DeskLogin from "@/components/DeskLogin";
import SiteHeader from "@/components/SiteHeader";

type Sub = {
  id: number;
  type: string;
  target_voyage: string | null;
  status: string;
  carta_version: string;
  created_at: string;
  payload: any;
  contributor: { handle: string; rank: string } | null;
  audit: { actor: string; action: string; verdict: string | null; findings: any; created_at: string }[];
  reviews: { reviewer: { handle: string; rank: string } | null; verdict: string; findings: any; created_at: string }[];
};

type CrewMember = {
  id: number;
  handle: string;
  rank: string;
  status: string;
  approvals: number;
  rejections: number;
  passed_curator: number;
  reviews_given: number;
  has_key: boolean;
  created_at: string | null;
};

type Demand = { id: number; query: string; hits: number; first_seen: string; last_seen: string };

type Overview = {
  counts: {
    submissions: Record<string, number>;
    gaps: Record<string, number>;
    contributors: Record<string, number>;
    reviews_total: number;
  };
  feed: { submission_id: number | null; actor: string; action: string; verdict: string | null; findings: any; created_at: string }[];
  demand?: Demand[];
};

const STATUS_COLOR: Record<string, string> = {
  submitted: "#b0873a",
  "peer-review": "#46608a",
  "human-review": "#3f8a8a",
  approved: "#4f8a5b",
  rejected: "#a3402c",
  "curator-rejected": "#a3402c",
  "changes-requested": "#8a5a9a",
};

const RANKS = ["cabin-boy", "deckhand", "navigator", "captain", "admiral"];
type Tab = "overview" | "submissions" | "crew";

export default function Desk() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [rankPick, setRankPick] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/desk/overview");
    if (r.status === 401) { setAuthed(false); return; }
    setOverview(await r.json());
    setAuthed(true);
    const [rs, rc] = await Promise.all([fetch("/api/desk/submissions"), fetch("/api/desk/crew")]);
    if (rs.ok) setSubs((await rs.json()).submissions ?? []);
    if (rc.ok) setCrew((await rc.json()).crew ?? []);
  }

  useEffect(() => {
    // Returning from Google OAuth: the token arrives in the URL hash.
    const m = window.location.hash.match(/access_token=([^&]+)/);
    if (m) {
      window.history.replaceState(null, "", window.location.pathname);
      fetch("/api/desk/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: decodeURIComponent(m[1]) }),
      }).then(async (r) => {
        if (!r.ok) setErr((await r.json()).error ?? "sign-in refused");
        load();
      });
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/desk/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) { setErr((await r.json()).error ?? "login failed"); return; }
    setPassword("");
    load();
  }

  async function verdict(id: number, v: string) {
    setBusy(true);
    const r = await fetch("/api/desk/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submission_id: id, verdict: v, note: note[id] || undefined }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  async function demandAction(id: number, action: "promote" | "dismiss", query: string) {
    if (!confirm(action === "promote"
      ? `Add “${query}” to the editorial roadmap as an open gap?`
      : `Dismiss “${query}” as out of scope? It stops appearing here.`)) return;
    setBusy(true);
    const r = await fetch("/api/desk/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    load();
  }

  async function crewAction(id: number, action: string, rank?: string) {
    const labels: Record<string, string> = {
      suspend: "Suspend this contributor? Their key stops working immediately.",
      reactivate: "Reactivate this contributor?",
      "set-rank": `Set rank to ${rank}?`,
      "rotate-key": "Rotate the api_key? The old key stops working; the new one is shown ONCE.",
    };
    if (!confirm(labels[action] ?? action)) return;
    setBusy(true);
    const r = await fetch("/api/desk/crew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contributor_id: id, action, rank }),
    });
    setBusy(false);
    const j = await r.json();
    if (!r.ok) { alert(j.error ?? "failed"); return; }
    if (j.api_key) prompt("New api_key — hand it to the contributor over a private channel. It is shown ONCE:", j.api_key);
    load();
  }

  if (authed === null) return <main style={{ padding: 40 }}>…</main>;

  if (!authed) {
    return (
      <>
      <SiteHeader />
      <DeskLogin
        email={email}
        password={password}
        error={err}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={login}
      />
      </>
    );
  }

  const openCount = (overview?.counts.submissions["human-review"] ?? 0) + (overview?.counts.submissions["peer-review"] ?? 0);

  return (
    <>
    <SiteHeader />
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "34px 22px 80px", lineHeight: 1.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
            Terraveler · Editorial desk
          </span>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.6rem" }}>
            {tab === "overview" ? "Quarterdeck" : tab === "submissions" ? "Submissions" : "Crew"}
          </h1>
        </div>
        <button className="desk-btn" onClick={async () => { await fetch("/api/desk/logout", { method: "POST" }); setAuthed(false); }}>
          Sign out
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 18, borderBottom: "1px solid var(--parchment-deep)", paddingBottom: 10 }}>
        {(["overview", "submissions", "crew"] as Tab[]).map((t) => (
          <button key={t} className="desk-btn" onClick={() => setTab(t)}
            style={tab === t ? { background: "var(--accent)", color: "var(--parchment)", borderColor: "var(--accent-deep)" } : {}}>
            {t === "overview" ? "⚓ Overview" : t === "submissions" ? `📜 Submissions${openCount ? ` (${openCount})` : ""}` : "🧑‍✈️ Crew"}
          </button>
        ))}
      </div>

      {tab === "overview" && overview && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 20 }}>
            {[
              ["Awaiting desk", overview.counts.submissions["human-review"] ?? 0],
              ["In peer review", overview.counts.submissions["peer-review"] ?? 0],
              ["Approved", overview.counts.submissions["approved"] ?? 0],
              ["Rejected", (overview.counts.submissions["rejected"] ?? 0) + (overview.counts.submissions["curator-rejected"] ?? 0)],
              ["Reviews given", overview.counts.reviews_total],
              ["Open gaps", overview.counts.gaps["open"] ?? 0],
              ["Claimed gaps", overview.counts.gaps["claimed"] ?? 0],
              ["Active crew", overview.counts.contributors["active"] ?? 0],
              ["Suspended", overview.counts.contributors["suspended"] ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)} style={{ border: "1px solid var(--parchment-deep)", borderRadius: 10, background: "rgba(255,255,255,0.35)", padding: "12px 14px" }}>
                <div style={{ fontSize: 26, fontFamily: "var(--font-display)" }}>{n}</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>{label}</div>
              </div>
            ))}
          </div>

          {overview.demand && overview.demand.length > 0 && (
            <>
              <h2 style={{ fontSize: "1.1rem", margin: "26px 0 4px" }}>Asked for, not held</h2>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 12px" }}>
                Searches that returned nothing. Promote one and it becomes an open gap
                on the public roadmap, for Scribes to claim.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {overview.demand.map((d) => (
                  <div key={d.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 10, flexWrap: "wrap", border: "1px solid var(--parchment-deep)",
                    borderRadius: 9, background: "rgba(255,255,255,0.35)", padding: "9px 12px",
                  }}>
                    <span>
                      <strong style={{ fontFamily: "var(--font-display)" }}>{d.query}</strong>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                        {" "}· {d.hits} search{d.hits === 1 ? "" : "es"} · last {new Date(d.last_seen).toLocaleDateString()}
                      </span>
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="desk-btn desk-btn-approve" disabled={busy}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => demandAction(d.id, "promote", d.query)}>
                        Add to roadmap
                      </button>
                      <button className="desk-btn" disabled={busy}
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => demandAction(d.id, "dismiss", d.query)}>
                        Dismiss
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 style={{ fontSize: "1.1rem", margin: "26px 0 10px" }}>Ship&apos;s log — latest activity</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            {overview.feed.map((a, i) => (
              <div key={i} style={{ borderBottom: "1px dashed var(--parchment-deep)", paddingBottom: 6 }}>
                <strong>{a.actor}</strong> · {a.action}
                {a.verdict ? ` → ${a.verdict}` : ""}
                {a.submission_id != null ? ` · #${a.submission_id}` : ""}
                <span style={{ color: "var(--ink-soft)" }}> · {new Date(a.created_at).toLocaleString()}</span>
                {Array.isArray(a.findings) && a.findings.length > 0 && (
                  <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 2 }}>
                    {a.findings.slice(0, 2).map((f: any, j: number) => (
                      <div key={j}>{Array.isArray(f) ? f[2] ?? f.join(" · ") : String(f)}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "submissions" && (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {subs.length === 0 && <p style={{ color: "var(--ink-soft)" }}>No submissions yet.</p>}
          {subs.map((s) => (
            <div key={s.id} style={{ border: "1px solid var(--parchment-deep)", borderRadius: 10, background: "rgba(255,255,255,0.35)", padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <strong style={{ fontFamily: "var(--font-display)" }}>
                  #{s.id} · {s.type}{s.target_voyage ? ` → ${s.target_voyage}` : ""}
                </strong>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {s.contributor && (
                    <span className="conf-badge">{s.contributor.handle} · {s.contributor.rank}</span>
                  )}
                  <span className="conf-badge" style={{ borderColor: STATUS_COLOR[s.status], color: STATUS_COLOR[s.status] }}>
                    {s.status}
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", margin: "4px 0 8px" }}>
                {new Date(s.created_at).toLocaleString()} · Carta v{s.carta_version}
              </div>

              <details>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>Payload</summary>
                <pre style={{ maxHeight: 300, overflow: "auto", fontSize: 11.5, background: "rgba(43,33,23,0.05)", padding: 10, borderRadius: 8 }}>
                  {JSON.stringify(s.payload, null, 2)}
                </pre>
              </details>

              {(s.reviews?.length ?? 0) > 0 && (
                <details style={{ marginTop: 6 }} open={s.status === "human-review"}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--accent)" }}>
                    Peer reviews ({s.reviews.length})
                  </summary>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                    {s.reviews.map((rv, i) => (
                      <div key={i} style={{ borderLeft: "3px solid var(--parchment-deep)", paddingLeft: 10 }}>
                        <strong>{rv.reviewer?.handle ?? "?"}</strong> · verdict: <strong>{rv.verdict}</strong>
                        <span style={{ color: "var(--ink-soft)" }}> · {new Date(rv.created_at).toLocaleString()}</span>
                        {Array.isArray(rv.findings) && (
                          <ul style={{ margin: "4px 0 0 18px", color: "var(--ink-soft)" }}>
                            {rv.findings.slice(0, 10).map((f: any, j: number) => (
                              <li key={j}>
                                {f.claim}: <strong>{f.assessment}</strong>
                                {f.evidence_url ? <> · <a href={f.evidence_url} target="_blank" rel="noreferrer">evidence</a></> : null}
                                {f.note ? ` — ${f.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {s.audit.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--ink-soft)" }}>
                    Audit trail ({s.audit.length})
                  </summary>
                  <div style={{ fontSize: 12.5, marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                    {s.audit.map((a, i) => (
                      <div key={i}>
                        <strong>{a.actor}</strong> · {a.action}
                        {a.verdict ? ` → ${a.verdict}` : ""} ·{" "}
                        <span style={{ color: "var(--ink-soft)" }}>{new Date(a.created_at).toLocaleString()}</span>
                        {Array.isArray(a.findings) && a.findings.length > 0 && (
                          <ul style={{ margin: "4px 0 0 18px", color: "var(--ink-soft)" }}>
                            {a.findings.slice(0, 12).map((f: any, j: number) => (
                              <li key={j}>{Array.isArray(f) ? f.join(" · ") : String(f)}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {["submitted", "peer-review", "human-review", "changes-requested"].includes(s.status) && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={note[s.id] ?? ""}
                    onChange={(e) => setNote({ ...note, [s.id]: e.target.value })}
                    placeholder="verdict note (recorded in the audit trail)"
                    className="desk-input"
                    style={{ flex: 1, minWidth: 220 }}
                  />
                  <button className="desk-btn desk-btn-approve" disabled={busy} onClick={() => verdict(s.id, "approve")}>Approve</button>
                  <button className="desk-btn desk-btn-changes" disabled={busy} onClick={() => verdict(s.id, "changes")}>Changes</button>
                  <button className="desk-btn desk-btn-reject" disabled={busy} onClick={() => verdict(s.id, "reject")}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "crew" && (
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          {crew.length === 0 && <p style={{ color: "var(--ink-soft)" }}>No contributors yet.</p>}
          {crew.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: "0.05em" }}>
                  {["Handle", "Rank", "Status", "Approved", "Rejected", "Reviews", "Actions"].map((h) => (
                    <th key={h} style={{ borderBottom: "2px solid var(--parchment-deep)", padding: "6px 8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crew.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--parchment-deep)", opacity: c.status === "suspended" ? 0.55 : 1 }}>
                    <td style={{ padding: "8px" }}>
                      <strong>{c.handle}</strong>
                      {!c.has_key && <span title="no personal key yet" style={{ marginLeft: 6, fontSize: 11, color: "var(--brass)" }}>⚠ no key</span>}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <select className="desk-input" style={{ padding: "4px 6px", fontSize: 12.5 }}
                        value={rankPick[c.id] ?? c.rank}
                        onChange={(e) => setRankPick({ ...rankPick, [c.id]: e.target.value })}>
                        {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {(rankPick[c.id] ?? c.rank) !== c.rank && (
                        <button className="desk-btn" disabled={busy} style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12 }}
                          onClick={() => crewAction(c.id, "set-rank", rankPick[c.id])}>set</button>
                      )}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span className="conf-badge" style={c.status === "suspended" ? { borderColor: "#a3402c", color: "#a3402c" } : { borderColor: "#4f8a5b", color: "#4f8a5b" }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>{c.approvals}</td>
                    <td style={{ padding: "8px" }}>{c.rejections}</td>
                    <td style={{ padding: "8px" }}>{c.reviews_given}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      {c.status === "active" ? (
                        <button className="desk-btn desk-btn-reject" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => crewAction(c.id, "suspend")}>Suspend</button>
                      ) : (
                        <button className="desk-btn desk-btn-approve" disabled={busy} style={{ padding: "4px 8px", fontSize: 12 }}
                          onClick={() => crewAction(c.id, "reactivate")}>Reactivate</button>
                      )}
                      <button className="desk-btn" disabled={busy} style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12 }}
                        onClick={() => crewAction(c.id, "rotate-key")}>Rotate key</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
    </>
  );
}
