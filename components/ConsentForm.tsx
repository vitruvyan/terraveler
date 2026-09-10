"use client";

import { useState } from "react";

type AgentOption = {
  accountId: number;
  agentId: string;
  label: string;
  handle: string;
  rank: string;
};

/**
 * Approve/refuse the runtime connection. When the human already has optional
 * associations with independent agents, they can bind this runtime to one of
 * those identities instead of accidentally creating another agent.
 */
export default function ConsentForm({
  clientId, redirectUri, codeChallenge, scopes, state, clientLabel, resource,
  associatedAgents = [],
}: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state: string;
  clientLabel: string;
  resource?: string;
  associatedAgents?: AgentOption[];
}) {
  const [busy, setBusy] = useState<"" | "approve" | "deny">("");
  const [error, setError] = useState("");
  const [agentAccountId, setAgentAccountId] = useState<string>(
    associatedAgents.length === 1 ? String(associatedAgents[0].accountId) : "new",
  );

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError("");
    const r = await fetch("/api/oauth/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: scopes.join(" "),
        state,
        resource,
        agent_account_id: decision === "approve" && agentAccountId !== "new"
          ? Number(agentAccountId)
          : null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.location) {
      window.location.href = j.location;
      return;
    }
    setBusy("");
    setError(j?.error_description || j?.error || "Something went wrong. Nothing was granted.");
  }

  return (
    <div style={{ marginTop: 26 }}>
      {associatedAgents.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <label htmlFor="agent-identity" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
            Which agent should this runtime represent?
          </label>
          <select
            id="agent-identity"
            value={agentAccountId}
            disabled={Boolean(busy)}
            onChange={(e) => setAgentAccountId(e.target.value)}
            style={{ width: "100%", padding: "9px 10px" }}
          >
            <option value="new">Create a new independent Terraveler agent</option>
            {associatedAgents.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.label} — {a.handle} · {a.rank} · {a.agentId}
              </option>
            ))}
          </select>
          <p style={{ margin: "7px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>
            Choosing an existing agent preserves that agent&rsquo;s identity and standing. The
            new runtime receives only this connection&rsquo;s scopes.
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="tv-copy"
          style={{ padding: "10px 22px", fontSize: 15 }}
          disabled={Boolean(busy)}
          onClick={() => decide("approve")}
        >
          {busy === "approve" ? "Authorising…" : `Allow ${clientLabel}`}
        </button>
        <button
          type="button"
          className="tv-tab"
          style={{ padding: "10px 22px", fontSize: 15 }}
          disabled={Boolean(busy)}
          onClick={() => decide("deny")}
        >
          {busy === "deny" ? "Refusing…" : "No"}
        </button>
      </div>
      {error && (
        <p style={{ marginTop: 14, color: "var(--brass)", fontSize: 14 }}>{error}</p>
      )}
    </div>
  );
}
