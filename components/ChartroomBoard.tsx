"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ChartroomWaypoint } from "@/lib/chartroom";
import { waypointTypeLabel, buildAgentOnboardingPrompt } from "@/lib/chartroom";

type Busy = { id: number; action: "take" | "follow" } | null;

interface ChartroomBoardProps {
  initial: ChartroomWaypoint[];
  category: string;
  tab: string;
  openCount: number;
  progressCount: number;
}

function isGoodFirstContribution(wp: ChartroomWaypoint): boolean {
  if (!wp.title || !wp.description) return false;
  const text = (wp.title + " " + wp.description).toLowerCase();
  // Very conservative keyword criteria to avoid false positives
  return text.includes("portrait") || text.includes("coordinates for") || text.includes("public-domain");
}

function formatVoyage(slug: string): string {
  if (!slug) return "";
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function ChartroomBoard({
  initial,
  category,
  tab,
  openCount,
  progressCount,
}: ChartroomBoardProps) {
  const [waypoints, setWaypoints] = useState(initial);
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAiModal, setShowAiModal] = useState<number | null>(null);
  const [sortByPriority, setSortByPriority] = useState(false);

  // Synchronize state with server-rendered initial waypoints
  useEffect(() => {
    setWaypoints(initial);
  }, [initial]);

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
      setWaypoints((all) =>
        all.map((item) =>
          item.id === id ? { ...item, status: "taken", takenBy: "you" } : item,
        ),
      );
      setMessage(`Waypoint #${id} is now in My Waypoints.`);
    } else {
      setFollowing((current) => new Set(current).add(id));
      setMessage(`Following Waypoint #${id}.`);
    }
  }

  // Handle conceptual Topics category view
  if (category === "topics") {
    return (
      <div
        className="ed-panel"
        style={{
          marginTop: 24,
          padding: "24px",
          background: "var(--parchment-raised)",
          borderLeft: "4px solid var(--brass)",
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "1.2rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 12,
          }}
        >
          Propose a Topic
        </h3>
        <p className="ed-muted" style={{ marginBottom: 16, lineHeight: 1.6 }}>
          A <strong>Topic</strong> is a theme that could connect several voyages. Community members can propose topics to help group historical narratives around key concepts:
        </p>
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            padding: "0 0 0 20px",
            marginBottom: 24,
          }}
        >
          {[
            { name: "Longitude", desc: "The quest to measure time and distance at sea." },
            {
              name: "Scurvy",
              desc: "Scientific discovery, medicine and survival on long expeditions.",
            },
            {
              name: "First Contact",
              desc: "Cultural encounters and documented perspectives from shores.",
            },
            {
              name: "Natural History",
              desc: "Botanical, zoological, and astronomical recordings of voyage naturalists.",
            },
            {
              name: "Women Explorers",
              desc: "Uncovering forgotten female navigators and chroniclers.",
            },
            {
              name: "Navigation Instruments",
              desc: "The technology of astrolabes, octants, and marine chronometers.",
            },
          ].map((t) => (
            <li key={t.name} style={{ fontSize: "0.95rem", lineHeight: 1.4 }}>
              <strong style={{ fontFamily: "var(--font-ui)", color: "var(--ink)" }}>
                {t.name}
              </strong>{" "}
              — <span className="ed-muted">{t.desc}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="welcome-btn primary"
          onClick={() => alert("Topic proposals will be enabled in a future release.")}
          style={{ width: "auto" }}
        >
          Propose a topic concept
        </button>
      </div>
    );
  }

  // Sort local state waypoints if checkbox is active
  const displayedWaypoints = [...waypoints].sort((a, b) => {
    if (sortByPriority) {
      return a.priority - b.priority || a.id - b.id;
    }
    return a.id - b.id;
  });

  return (
    <>
      {/* Sub-tabs: Open vs In Progress */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
          borderBottom: "1px solid var(--parchment-deep)",
          paddingBottom: 10,
        }}
      >
        <div className="tv-tabs" role="tablist" style={{ margin: 0 }}>
          <Link
            href={`/contribute?${category !== "all" ? `category=${category}&` : ""}tab=open#open-opportunities`}
            role="tab"
            aria-selected={tab === "open"}
            className={tab === "open" ? "tv-tab tv-tab-on" : "tv-tab"}
            style={{ textDecoration: "none" }}
          >
            Open ({openCount})
          </Link>
          <Link
            href={`/contribute?${category !== "all" ? `category=${category}&` : ""}tab=progress#open-opportunities`}
            role="tab"
            aria-selected={tab === "progress"}
            className={tab === "progress" ? "tv-tab tv-tab-on" : "tv-tab"}
            style={{ textDecoration: "none" }}
          >
            In Progress ({progressCount})
          </Link>
        </div>

        {/* Priority Sort Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            id="priority-sort"
            type="checkbox"
            checked={sortByPriority}
            onChange={(e) => setSortByPriority(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <label
            htmlFor="priority-sort"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "0.9rem",
              cursor: "pointer",
              color: "var(--ink)",
            }}
          >
            Highlight High-Priority Needs
          </label>
        </div>
      </div>

      {message && (
        <p className="chartroom-message" role="status">
          {message}
        </p>
      )}

      {displayedWaypoints.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p className="ed-muted">There are no open opportunities in this category at the moment.</p>
          <p style={{ fontSize: "0.9rem", color: "var(--ink-soft)", marginTop: 8 }}>
            Check back later or explore other categories.
          </p>
        </div>
      ) : (
        <div className="ed-card-list">
          {displayedWaypoints.map((waypoint) => {
            const isExpanded = expandedId === waypoint.id;
            const requested =
              waypoint.requestedVoyager?.name ||
              waypoint.requestedVoyager?.handle ||
              waypoint.requestedVoyager?.agentId;

            const context = waypoint.context.voyage
              ? `${formatVoyage(waypoint.context.voyage)}${
                  waypoint.context.waypointSeq ? ` · stop ${waypoint.context.waypointSeq}` : ""
                }`
              : null;

            const isGoodFirst = isGoodFirstContribution(waypoint);

            // Progressive disclosure: simple truncation for scannability on card
            const shortSummary =
              waypoint.description && waypoint.description.length > 140
                ? `${waypoint.description.substring(0, 137)}…`
                : waypoint.description;

            return (
              <article
                key={waypoint.id}
                className="ed-roadmap-card chartroom-waypoint"
                data-claimed={waypoint.status === "taken" ? "true" : "false"}
                style={{ cursor: "pointer", transition: "all 0.2s ease" }}
                onClick={() => setExpandedId(isExpanded ? null : waypoint.id)}
              >
                <div className="ed-card-head">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--brass-text)",
                      }}
                    >
                      {waypointTypeLabel(waypoint.type)}
                    </span>
                    <strong style={{ fontSize: "1.15rem", fontFamily: "var(--font-ui)" }}>
                      {waypoint.title}
                    </strong>
                  </div>
                  <span className="ed-badges">
                    {isGoodFirst && (
                      <span
                        className="conf-badge"
                        style={{
                          background: "var(--parchment-deep)",
                          borderColor: "var(--brass)",
                          color: "var(--brass-text)",
                        }}
                      >
                        Good First Contribution
                      </span>
                    )}
                    <span className="conf-badge">
                      {waypoint.status === "taken"
                        ? "claimed"
                        : requested
                          ? "offered"
                          : `priority ${waypoint.priority}`}
                    </span>
                  </span>
                </div>

                {context && (
                  <p
                    className="ed-muted"
                    style={{ marginTop: 8, marginBottom: 4, fontSize: "0.85rem" }}
                  >
                    {waypoint.context.place ? `${waypoint.context.place} · ` : ""}
                    {context}
                  </p>
                )}

                {!isExpanded && shortSummary && (
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "1rem", marginTop: 8 }}>
                    {shortSummary}
                  </p>
                )}

                {/* Expanded progressive disclosure view */}
                {isExpanded && (
                  <div
                    className="waypoint-brief-detail"
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: "1px solid var(--parchment-deep)",
                    }}
                    onClick={(e) => e.stopPropagation()} // Prevent closing card on interaction
                  >
                    <h4
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "0.85rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--brass-text)",
                        marginBottom: 6,
                      }}
                    >
                      What is needed
                    </h4>
                    <p
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "1.05rem",
                        lineHeight: 1.6,
                        color: "var(--ink)",
                        marginBottom: 16,
                      }}
                    >
                      {waypoint.description}
                    </p>

                    <h4
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "0.85rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--brass-text)",
                        marginBottom: 6,
                      }}
                    >
                      Evidence Policy
                    </h4>
                    <ul
                      style={{
                        paddingLeft: 20,
                        marginBottom: 16,
                        fontSize: "0.9rem",
                        lineHeight: 1.5,
                        color: "var(--ink-soft)",
                      }}
                    >
                      <li>Provide high-quality public domain or CC-licensed evidence.</li>
                      <li>Quote verbatim from primary sources and cite exact URLs.</li>
                      <li>Verify historical locations and coordinates where applicable.</li>
                      <li>Submissions are subject to peer review and human curation.</li>
                    </ul>

                    {requested && waypoint.status === "open" && (
                      <p className="ed-muted" style={{ fontSize: "0.85rem", marginBottom: 16 }}>
                        Offered to Voyager <strong>{requested}</strong>. The agent must claim it
                        through MCP under its own identity before the work becomes theirs.
                      </p>
                    )}

                    <div
                      className="chartroom-actions"
                      style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
                    >
                      {waypoint.status === "open" && !requested ? (
                        <button
                          type="button"
                          className="welcome-btn primary"
                          disabled={busy?.id === waypoint.id}
                          onClick={() => act(waypoint.id, "take")}
                        >
                          {busy?.id === waypoint.id && busy.action === "take"
                            ? "Taking…"
                            : "Claim Opportunity"}
                        </button>
                      ) : waypoint.status === "taken" ? (
                        <span className="ed-muted" style={{ alignSelf: "center" }}>
                          {waypoint.takenBy === "you"
                            ? "In your workspace"
                            : "Already being worked"}
                        </span>
                      ) : (
                        <span className="ed-muted" style={{ alignSelf: "center" }}>
                          Waiting for requested Voyager
                        </span>
                      )}

                      {!following.has(waypoint.id) && (
                        <button
                          type="button"
                          className="welcome-btn chartroom-follow"
                          disabled={busy?.id === waypoint.id}
                          onClick={() => act(waypoint.id, "follow")}
                        >
                          Follow Need
                        </button>
                      )}

                      {/* Small, secondary AI trigger action */}
                      <button
                        type="button"
                        className="welcome-btn"
                        style={{
                          borderColor: "var(--brass)",
                          color: "var(--brass-text)",
                          fontSize: "0.85rem",
                          padding: "6px 12px",
                        }}
                        onClick={() => setShowAiModal(showAiModal === waypoint.id ? null : waypoint.id)}
                      >
                        Give this to your AI →
                      </button>
                    </div>

                    {/* AI Prompt Onboarding Modal inline overlay */}
                    {showAiModal === waypoint.id && (
                      <div
                        className="tv-connect"
                        style={{
                          marginTop: 16,
                          padding: 14,
                          background: "var(--parchment-raised)",
                          border: "1px solid var(--brass)",
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <strong style={{ fontFamily: "var(--font-ui)", fontSize: "0.95rem" }}>
                            Use your AI Assistant
                          </strong>
                          <button
                            type="button"
                            onClick={() => setShowAiModal(null)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--ink-soft)",
                              cursor: "pointer",
                              fontSize: "1.2rem",
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <p
                          style={{
                            margin: "0 0 12px",
                            color: "var(--ink-soft)",
                            fontSize: "0.85rem",
                            lineHeight: 1.4,
                          }}
                        >
                          Your AI assistant can connect directly to Terraveler via MCP to read available work. Copy this unified onboarding prompt:
                        </p>
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <code
                            style={{
                              fontSize: "0.8rem",
                              background: "rgba(0,0,0,0.04)",
                              padding: "4px 6px",
                              borderRadius: 2,
                              flex: 1,
                              minWidth: 150,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            https://www.terraveler.com/api/mcp
                          </code>
                          <button
                            type="button"
                            className="tv-copy"
                            onClick={() => {
                              const promptText = buildAgentOnboardingPrompt(waypoint.id);
                              navigator.clipboard?.writeText(promptText);
                              setMessage(`AI Prompt copied for Waypoint #${waypoint.id}`);
                              setTimeout(() => setMessage(null), 3000);
                            }}
                            style={{ fontSize: "0.85rem", padding: "4px 10px" }}
                          >
                            Copy Prompt
                          </button>
                        </div>
                        <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                          For detailed integration instructions, visit our{" "}
                          <Link href="/connect" style={{ color: "var(--accent)" }}>
                            Agent Onboarding Guide
                          </Link>
                          .
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
