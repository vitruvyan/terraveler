"use client";

import { useState } from "react";

/**
 * Approve or refuse, and nothing else on the page competes with the two.
 *
 * Refusing redirects back to the client with `error=access_denied` rather than
 * dead-ending here: a client that is told no can say so, whereas a client left
 * hanging tells the person their assistant is broken.
 */
export default function ConsentForm({
  clientId, redirectUri, codeChallenge, scopes, state, clientLabel, resource,
}: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state: string;
  clientLabel: string;
  /** Carried through so the code is bound to the server it was asked for. */
  resource?: string;
}) {
  const [busy, setBusy] = useState<"" | "approve" | "deny">("");
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError("");
    const r = await fetch("/api/oauth/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision, client_id: clientId, redirect_uri: redirectUri,
        code_challenge: codeChallenge, scope: scopes.join(" "), state, resource,
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
