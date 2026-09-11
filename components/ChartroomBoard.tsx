"use client";

import { useState } from "react";
import type { ChartroomWaypoint } from "@/lib/chartroom";
import { waypointTypeLabel } from "@/lib/chartroom";

type Busy = { id: number; action: "take" | "follow" } | null;

export default function ChartroomBoard({ initial }: { initial: ChartroomWaypoint[] }) {
  const [waypoints, setWaypoints] = useState(initial);
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(id: number, action: "take" | "follow") {
    setBusy({ id, action });
    setMessage(null);
    const response = await fetch("/api/chartroom/waypoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoint_id: id, action }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (response.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/contribute")}`;
      return;
    }
    if (!response.ok) {
      setMessage(result.error || "The Chartroom could not record that action.");
      return;
    }
    if (action === "take") {
      setWaypoints((all) => all.map((item) =>
        item.id === id ? { ...item, status: "taken", takenBy: "you" } : item,
      ));
      setMessage(`Waypoint #${id} is now in My Waypoints.`);
    } else {
      setFollowing((current) => new Set(current).add(id));
      setMessage(`Following Waypoint #${id}.`);
    }
  }

  return (
    <>
      {message && <p className="chartroom-message" role="status">{message}</p>}
      <div className="ed-card-list">
        {waypoints.map((waypoint) => {
          const requested = waypoint.requestedVoyager?.name
            || waypoint.requestedVoyager?.handle
            || waypoint.requestedVoyager?.agentId;
          const context = waypoint.context.voyage
            ? `${waypoint.context.voyage}${waypoint.context.waypointSeq ? ` · stop ${waypoint.context.waypointSeq}` : ""}`
            : null;

          return (
            <article
              key={waypoint.id}
              className="ed-roadmap-card chartroom-waypoint"
              data-claimed={waypoint.status === "taken" ? "true" : "false"}
            >
              <div className="ed-card-head">
                <strong>{waypoint.title}</strong>
                <span className="ed-badges">
                  <span className="conf-badge">{waypointTypeLabel(waypoint.type)}</span>
                  <span className="conf-badge">
                    {waypoint.status === "taken"
                      ? "taken"
                      : requested
                        ? "offered"
                        : `priority ${waypoint.priority}`}
                  </span>
                </span>
              </div>
              {context && (
                <p className="ed-muted" style={{ marginBottom: 4 }}>
                  {waypoint.context.place ? `${waypoint.context.place} · ` : ""}{context}
                </p>
              )}
              {waypoint.description && <p>{waypoint.description}</p>}
              {requested && waypoint.status === "open" && (
                <p className="ed-muted">
                  Offered to Voyager <strong>{requested}</strong>. The agent must claim it through MCP under its own identity before the work becomes theirs.
                </p>
              )}
              <div className="chartroom-actions">
                {waypoint.status === "open" && !requested ? (
                  <button
                    type="button"
                    className="welcome-btn primary"
                    disabled={busy?.id === waypoint.id}
                    onClick={() => act(waypoint.id, "take")}
                  >
                    {busy?.id === waypoint.id && busy.action === "take" ? "Taking…" : "Work on this"}
                  </button>
                ) : waypoint.status === "taken" ? (
                  <span className="ed-muted">
                    {waypoint.takenBy === "you" ? "In your workspace" : "Already being worked"}
                  </span>
                ) : (
                  <span className="ed-muted">Waiting for the requested Voyager to claim it</span>
                )}
                {!following.has(waypoint.id) && (
                  <button
                    type="button"
                    className="welcome-btn chartroom-follow"
                    disabled={busy?.id === waypoint.id}
                    onClick={() => act(waypoint.id, "follow")}
                  >
                    Follow
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
