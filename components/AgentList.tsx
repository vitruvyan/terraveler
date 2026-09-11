"use client";

import { useState } from "react";

type Agent = {
  id: number;
  agentId: string | null;
  name: string;
  handle: string | null;
  scopes: string[];
  created: string;
  lastUsed: string | null;
  revoked: boolean;
};

/**
 * Each row is one runtime the account authorised — a technical connection,
 * which is not the agent (named beside it where one is bound) and not the
 * association. Revoking it stops the runtime; it does not delete, revoke or
 * disassociate the agent.
 */
export default function AgentList({ agents }: { agents: Agent[] }) {
  const [state, setState] = useState<Record<number, "idle" | "working" | "revoked" | "error">>({});
  const [confirming, setConfirming] = useState<number | null>(null);

  async function revoke(id: number) {
    setState((s) => ({ ...s, [id]: "working" }));
    const r = await fetch("/api/oauth/connections/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: id }),
    });
    setState((s) => ({ ...s, [id]: r.ok ? "revoked" : "error", }));
    setConfirming(null);
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
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                <strong>{a.name}</strong>
                {a.handle && (
                  <span style={{ color: "var(--ink-soft)" }}> — writes as {a.handle}</span>
                )}
              </div>
              {a.agentId && (
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  Agent identity: <code style={{ wordBreak: "break-all" }}>{a.agentId}</code>
                </div>
              )}
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Authorised {a.created}
                {a.lastUsed ? ` · last active ${a.lastUsed}` : " · never active"}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Authorisation: {a.scopes.length ? a.scopes.join(", ") : "none granted"}
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              {gone ? (
                <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Runtime access revoked</span>
              ) : confirming === a.id ? (
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.55 }}>
                    This runtime will no longer be authorised to act through this
                    connection. The agent itself is not deleted or disassociated.
                  </p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button type="button" className="tv-tab" onClick={() => setConfirming(null)}>
                      Keep access
                    </button>
                    <button
                      type="button"
                      className="tv-tab tv-tab-on"
                      disabled={state[a.id] === "working"}
                      onClick={() => revoke(a.id)}
                    >
                      {state[a.id] === "working" ? "Revoking…" : "Revoke runtime access"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="tv-tab"
                  onClick={() => setConfirming(a.id)}
                >
                  Revoke runtime access…
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
