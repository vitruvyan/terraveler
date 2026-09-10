"use client";

import { useState } from "react";

type AssociatedAgent = {
  accountId: number;
  agentId: string;
  name: string;
  handle: string;
  rank: string;
  associated: string;
};

export default function AssociatedAgentList({ agents }: { agents: AssociatedAgent[] }) {
  const [busy, setBusy] = useState<number | null>(null);
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
    setHidden((old) => new Set([...old, accountId]));
  }

  const visible = agents.filter((a) => !hidden.has(a.accountId));
  if (!visible.length) return null;

  return (
    <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
      {visible.map((a) => (
        <div key={a.accountId} className="tv-connect" style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>
              <strong>{a.name}</strong>
              <span style={{ color: "var(--ink-soft)" }}> — {a.handle} · {a.rank}</span>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                Agent identity: <code>{a.agentId}</code> · associated {a.associated}
              </div>
            </div>
            <button
              type="button"
              className="tv-tab"
              disabled={busy === a.accountId}
              onClick={() => unlink(a.accountId)}
            >
              {busy === a.accountId ? "Removing…" : "Remove association"}
            </button>
          </div>
        </div>
      ))}
      {error && <p style={{ margin: 0, color: "var(--brass)", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
