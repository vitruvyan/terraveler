"use client";

import { useState } from "react";

type Agent = {
  id: number;
  name: string;
  handle: string | null;
  scopes: string[];
  created: string;
  lastUsed: string | null;
  revoked: boolean;
};

/**
 * One row, one revoke. No bulk action and no confirmation dialog: revoking is
 * cheap to undo — the agent asks again and the person approves again — so a
 * modal here would be friction protecting nothing.
 */
export default function AgentList({ agents }: { agents: Agent[] }) {
  const [state, setState] = useState<Record<number, "idle" | "working" | "revoked" | "error">>({});

  async function revoke(id: number) {
    setState((s) => ({ ...s, [id]: "working" }));
    const r = await fetch("/api/oauth/connections/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: id }),
    });
    setState((s) => ({ ...s, [id]: r.ok ? "revoked" : "error" }));
  }

  return (
    <div style={{ marginTop: 22, display: "grid", gap: 12 }}>
      {agents.map((a) => {
        const gone = a.revoked || state[a.id] === "revoked";
        return (
          <div
            key={a.id}
            className="tv-connect"
            style={{ padding: "14px 18px", opacity: gone ? 0.55 : 1 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
              <div>
                <strong>{a.name}</strong>
                {a.handle && (
                  <span style={{ color: "var(--ink-soft)" }}> — writes as {a.handle}</span>
                )}
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
                  {a.scopes.length ? a.scopes.join(", ") : "no permissions"} · authorised {a.created}
                  {a.lastUsed ? ` · last used ${a.lastUsed}` : " · never used"}
                </div>
              </div>
              {gone ? (
                <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>revoked</span>
              ) : (
                <button
                  type="button"
                  className="tv-tab"
                  disabled={state[a.id] === "working"}
                  onClick={() => revoke(a.id)}
                >
                  {state[a.id] === "working" ? "Revoking…" : "Revoke"}
                </button>
              )}
            </div>
            {state[a.id] === "error" && (
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--brass)" }}>
                That did not go through. Nothing changed — try again.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
