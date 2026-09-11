"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReleaseOfferButton({ waypointId }: { waypointId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/chartroom/offers/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoint_id: waypointId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "The offer could not be released.");
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="welcome-btn chartroom-follow"
        disabled={busy}
        onClick={release}
      >
        {busy ? "Releasing…" : "Release offer"}
      </button>
      {error && <p className="ed-muted" role="alert">{error}</p>}
    </div>
  );
}
