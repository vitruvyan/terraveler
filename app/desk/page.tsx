"use client";

import { useEffect, useState } from "react";

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
};

const STATUS_COLOR: Record<string, string> = {
  submitted: "#b0873a",
  "human-review": "#3f8a8a",
  approved: "#4f8a5b",
  rejected: "#a3402c",
  "curator-rejected": "#a3402c",
  "changes-requested": "#8a5a9a",
};

export default function Desk() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/desk/submissions");
    if (r.status === 401) { setAuthed(false); return; }
    const j = await r.json();
    setSubs(j.submissions ?? []);
    setAuthed(true);
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

  if (authed === null) return <main style={{ padding: 40 }}>…</main>;

  if (!authed) {
    return (
      <main style={{ maxWidth: 380, margin: "10vh auto", padding: "0 22px" }}>
        <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
          Terraveler · Editorial desk
        </span>
        <h1 style={{ margin: "6px 0 18px", fontSize: "1.6rem" }}>Sign in</h1>
        <a href="/api/desk/google" className="desk-btn desk-btn-primary"
           style={{ display: "block", textAlign: "center", textDecoration: "none", marginBottom: 14 }}>
          Sign in with Google
        </a>
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
          — or with email —
        </div>
        <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email"
            type="email" autoComplete="username" className="desk-input" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password"
            type="password" autoComplete="current-password" className="desk-input" />
          <button type="submit" className="desk-btn desk-btn-primary">Enter the desk</button>
          {err && <div style={{ color: "#a3402c", fontSize: 13 }}>{err}</div>}
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "34px 22px 80px", lineHeight: 1.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <span style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, color: "var(--brass)" }}>
            Terraveler · Editorial desk
          </span>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.6rem" }}>Submissions</h1>
        </div>
        <button className="desk-btn" onClick={async () => { await fetch("/api/desk/logout", { method: "POST" }); setAuthed(false); }}>
          Sign out
        </button>
      </div>

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

            {["submitted", "human-review", "changes-requested"].includes(s.status) && (
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
    </main>
  );
}
