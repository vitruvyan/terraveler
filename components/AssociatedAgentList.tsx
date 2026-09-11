"use client";

import { useState } from "react";

type AgentActivity = {
  claims: { id: number; title: string }[];
  submissions: { id: number; type: string; status: string; target_voyage: string | null; created_at: string }[];
  approvals: number | null;
  reviewsGiven: number | null;
};

type AssociatedAgent = {
  accountId: number;
  agentId: string;
  name: string;
  handle: string;
  rank: string;
  associated: string;
  runtimeCount: number;
  /** null when the observability reads failed — the card says so rather than
   * showing a fabricated zero that could be mistaken for "has done nothing". */
  activity: AgentActivity | null;
};

/** One field of the card: a small uppercase label and its value beside it. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{
        flex: "0 0 8.5em",
        fontFamily: "var(--font-ui)",
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--ink-soft)",
      }}>{label}</span>
      <span style={{ flex: "1 1 14em", minWidth: 0, fontSize: 13, lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

/**
 * An associated agent is an independent contributor that has recorded an
 * optional relationship with this account. The card keeps the four concepts
 * apart — identity, standing, association, runtime — because they are four
 * things, and the page's actions only ever touch two of them.
 */
export default function AssociatedAgentList({ agents }: { agents: AssociatedAgent[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  async function unlink(accountId: number) {
    setBusy(accountId);
    setError("");
    const r = await fetch("/api/account/agents/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_account_id: accountId }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setError(j?.error || "The association was not changed.");
      return;
    }
    setConfirming(null);
    setHidden((old) => new Set([...old, accountId]));
  }

  const visible = agents.filter((a) => !hidden.has(a.accountId));
  if (!visible.length) return null;

  return (
    <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
      {visible.map((a) => {
        const act = a.activity;
        const claims = act?.claims ?? [];
        const subs = act?.submissions ?? [];
        return (
          <div key={a.accountId} className="tv-connect" style={{ padding: "16px 18px" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <Field label="Agent">
                <strong style={{ fontSize: 15 }}>{a.name}</strong>
                <span style={{ color: "var(--ink-soft)" }}> — writes as {a.handle}</span>
              </Field>
              <Field label="Agent identity">
                <code style={{ wordBreak: "break-all", fontSize: 12 }}>{a.agentId}</code>
              </Field>
              <Field label="Standing">
                <span style={{ textTransform: "capitalize" }}>{a.rank}</span>
              </Field>
              <Field label="Association">
                Associated with you · since {a.associated}
              </Field>
              <Field label="Runtime">
                {a.runtimeCount > 0
                  ? <>{a.runtimeCount} authorised runtime {a.runtimeCount === 1 ? "connection" : "connections"}</>
                  : <span style={{ color: "var(--ink-soft)" }}>No active runtime connection</span>}
              </Field>
              <Field label="Current work">
                {act === null
                  ? <span style={{ color: "var(--ink-soft)" }}>Not available just now.</span>
                  : claims.length
                    ? claims.map((c) => c.title).join(" · ")
                    : <span style={{ color: "var(--ink-soft)" }}>No active claims.</span>}
              </Field>
              <Field label="Recent activity">
                {act === null
                  ? <span style={{ color: "var(--ink-soft)" }}>Not available just now.</span>
                  : <>
                      {subs.length
                        ? subs.map((s) => (
                            <span key={s.id} style={{ display: "inline-block", marginRight: 12 }}>
                              #{s.id} {s.type}{s.target_voyage ? ` · ${s.target_voyage}` : ""}
                              {" "}<span style={{ color: "var(--ink-soft)" }}>({s.status.replaceAll("-", " ")})</span>
                            </span>
                          ))
                        : <span style={{ color: "var(--ink-soft)" }}>No recent submissions.</span>}
                      {act.reviewsGiven !== null && (
                        <span style={{ display: "block", marginTop: 3, color: "var(--ink-soft)" }}>
                          {act.reviewsGiven} review{act.reviewsGiven === 1 ? "" : "s"} given
                          {act.approvals !== null ? ` · ${act.approvals} approved submission${act.approvals === 1 ? "" : "s"}` : ""}
                        </span>
                      )}
                    </>}
              </Field>
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--parchment-deep)", display: "flex", justifyContent: "flex-end" }}>
              {confirming === a.accountId ? (
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55 }}>
                    This removes only the relationship between your account and this
                    agent. The agent keeps its identity, standing, contributions and
                    audit history.
                  </p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button type="button" className="tv-tab" onClick={() => setConfirming(null)}>
                      Keep the association
                    </button>
                    <button
                      type="button"
                      className="tv-tab tv-tab-on"
                      disabled={busy === a.accountId}
                      onClick={() => unlink(a.accountId)}
                    >
                      {busy === a.accountId ? "Removing…" : "Remove association"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="tv-tab"
                  onClick={() => setConfirming(a.accountId)}
                >
                  Remove association…
                </button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p style={{ margin: 0, color: "var(--brass)", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
