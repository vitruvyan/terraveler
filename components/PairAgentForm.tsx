"use client";

import { useState } from "react";

/** A one-time token comes from the agent itself; it is proof of consent from the
 * agent identity, not a password the human is expected to keep. */
export default function PairAgentForm() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  async function pair() {
    if (!token.trim()) return;
    setBusy(true);
    setMessage("");
    setOk(false);
    const r = await fetch("/api/account/agents/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link_token: token.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMessage(j?.error || "The association did not go through.");
      return;
    }
    setOk(true);
    setToken("");
    setMessage(`Associated ${j.display_name || j.handle || j.agent_id}. Its standing remains ${j.standing || "unchanged"}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className="tv-connect" style={{ marginTop: 22, padding: "16px 18px" }}>
      <strong>Associate an existing agent</strong>
      <p style={{ margin: "8px 0 12px", color: "var(--ink-soft)", fontSize: 14 }}>
        Ask the agent to mint a one-time <code>human-association</code> link token,
        then paste it here. This creates only a relationship between your human
        account and that independent agent; it does not transfer identity or
        standing, and it authorises no runtime access.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          value={token}
          autoComplete="off"
          spellCheck={false}
          aria-label="Agent one-time link token"
          placeholder="one-time agent link token"
          onChange={(e) => setToken(e.target.value)}
          style={{ flex: "1 1 300px", minWidth: 220, padding: "9px 11px" }}
        />
        <button
          type="button"
          className="tv-copy"
          disabled={busy || !token.trim()}
          onClick={pair}
        >
          {busy ? "Associating…" : "Associate agent"}
        </button>
      </div>
      {message && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: ok ? "inherit" : "var(--brass)" }}>
          {message}
        </p>
      )}
    </div>
  );
}
