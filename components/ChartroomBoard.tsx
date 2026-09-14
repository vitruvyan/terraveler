"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ChartroomWaypoint } from "@/lib/chartroom";
import {
  buildAgentOnboardingPrompt,
  buildAgentProposalPrompt,
  waypointTypeLabel,
} from "@/lib/chartroom";
import { fetchCurrentPrompts, type PromptMap } from "@/lib/promptRegistry";

type Busy = { id: number; action: "take" | "follow" } | null;
type ProposalDraft = {
  title: string;
  why: string;
  context: string;
  evidence: string;
};

interface ChartroomBoardProps {
  initial: ChartroomWaypoint[];
  category: string;
  tab: string;
  mode: "ongoing" | "propose";
  openCount: number;
  progressCount: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "Any area",
  stories: "Stories",
  images: "Images",
  peoples: "Peoples & Encounters",
  places: "Places",
  sources: "Sources",
  topics: "Topics",
  review: "Review",
};

const PROPOSAL_GUIDANCE: Record<string, { headline: string; body: string; examples: string[] }> = {
  all: {
    headline: "What should Terraveler explore next?",
    body: "Propose one meaningful gap that is not already covered. It may be a voyage, visual corpus, encounter, place, source set, topic or review question.",
    examples: ["A missing voyage", "A neglected historical perspective", "A theme connecting several voyages"],
  },
  stories: {
    headline: "Propose a story the atlas does not yet tell.",
    body: "Suggest a voyage, episode or narrative thread that deserves a place in Terraveler and explain why it matters.",
    examples: ["A voyage not yet represented", "A missing episode within a known voyage", "A translation worth adding"],
  },
  images: {
    headline: "Propose a visual collection worth adding.",
    body: "Identify imagery, charts, engravings or visual evidence that would materially improve how a voyage or topic is understood.",
    examples: ["A historical chart collection", "A missing portrait set", "Visual evidence for a landfall"],
  },
  peoples: {
    headline: "Propose a people or encounter that needs context.",
    body: "Suggest where the atlas should better distinguish the voyager's account from historical context and modern scholarship.",
    examples: ["A first-contact episode", "An indigenous perspective", "Material culture around an encounter"],
  },
  places: {
    headline: "Propose a place the atlas should recover.",
    body: "Identify a historical port, landfall, route or uncertain location that deserves geographical investigation.",
    examples: ["A disputed landfall", "A historical port", "A route segment needing reconstruction"],
  },
  sources: {
    headline: "Propose a source corpus the atlas is missing.",
    body: "Point Terraveler toward primary texts, archives, translations or source groups that could strengthen existing content.",
    examples: ["A neglected primary journal", "A public-domain archive", "A source set for cross-checking claims"],
  },
  topics: {
    headline: "Propose a theme that crosses voyages.",
    body: "Topics are not tags. They are editorial paths through the atlas: recurring ideas that connect different journeys, periods and sources.",
    examples: ["Longitude", "Scurvy and survival at sea", "First contact", "Natural history", "Navigation instruments"],
  },
  review: {
    headline: "Propose something the atlas should re-examine.",
    body: "Suggest a claim, representation pattern or body of evidence that deserves independent editorial review.",
    examples: ["Representation of indigenous voices", "A disputed route claim", "A source-quality review"],
  },
};

function isGoodFirstContribution(wp: ChartroomWaypoint): boolean {
  if (!wp.title || !wp.description) return false;
  const text = `${wp.title} ${wp.description}`.toLowerCase();
  return text.includes("portrait") || text.includes("coordinates for") || text.includes("public-domain");
}

function formatVoyage(slug: string): string {
  if (!slug) return "";
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function proposalText(category: string, draft: ProposalDraft) {
  return `Terraveler proposal\n\nCategory: ${CATEGORY_LABELS[category] ?? category}\nTitle: ${draft.title}\n\nWhy this belongs in the atlas:\n${draft.why}\n\nContext / related voyages:\n${draft.context || "Not specified"}\n\nPossible evidence or starting points:\n${draft.evidence || "Not specified"}`;
}

export default function ChartroomBoard({
  initial,
  category,
  tab,
  mode,
  openCount,
  progressCount,
}: ChartroomBoardProps) {
  const [waypoints, setWaypoints] = useState(initial);
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAiModal, setShowAiModal] = useState<number | "proposal" | null>(null);
  const [sortByPriority, setSortByPriority] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [draft, setDraft] = useState<ProposalDraft>({ title: "", why: "", context: "", evidence: "" });
  const [prompts, setPrompts] = useState<PromptMap | null>(null);

  useEffect(() => {
    setWaypoints(initial);
  }, [initial]);

  // Fetched once on mount, not inside the click handler: clipboard writes
  // must fire synchronously within the user gesture that triggered them, so
  // the "Copy Prompt" buttons below read from this already-resolved state.
  useEffect(() => {
    fetchCurrentPrompts().then(setPrompts);
  }, []);

  useEffect(() => {
    setWizardStep(1);
    setDraft({ title: "", why: "", context: "", evidence: "" });
  }, [category]);

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
      setWaypoints((all) => all.map((item) => item.id === id ? { ...item, status: "taken", takenBy: "you" } : item));
      setMessage(`Waypoint #${id} is now in My Waypoints.`);
    } else {
      setFollowing((current) => new Set(current).add(id));
      setMessage(`Following Waypoint #${id}.`);
    }
  }

  const displayedWaypoints = useMemo(() => {
    return [...waypoints].sort((a, b) => {
      if (sortByPriority) return a.priority - b.priority || a.id - b.id;
      return a.id - b.id;
    });
  }, [waypoints, sortByPriority]);

  if (mode === "propose") {
    const guide = PROPOSAL_GUIDANCE[category] ?? PROPOSAL_GUIDANCE.all;
    const canAdvance = wizardStep === 1 || (wizardStep === 2 ? draft.title.trim().length >= 4 && draft.why.trim().length >= 20 : true);

    return (
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.35fr) minmax(240px, .65fr)",
            gap: 18,
            alignItems: "stretch",
          }}
        >
          <section
            className="ed-panel"
            style={{
              padding: "24px",
              background: "var(--parchment-raised)",
              borderLeft: "4px solid var(--brass)",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-text)" }}>
              {CATEGORY_LABELS[category] ?? "Proposal"}
            </span>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem, 4vw, 2.45rem)", lineHeight: 1.05, margin: "8px 0 10px" }}>
              {guide.headline}
            </h3>
            <p className="ed-muted" style={{ maxWidth: 720, lineHeight: 1.6, margin: 0 }}>{guide.body}</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
              {guide.examples.map((example) => (
                <span key={example} className="conf-badge" style={{ background: "transparent", borderColor: "var(--rule-hair)" }}>
                  {example}
                </span>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
              <button type="button" className="welcome-btn primary" onClick={() => setShowWizard(true)}>
                Start a human proposal
              </button>
              <button
                type="button"
                className="welcome-btn"
                style={{ borderColor: "var(--brass)", color: "var(--brass-text)" }}
                onClick={() => setShowAiModal(showAiModal === "proposal" ? null : "proposal")}
              >
                Give this to your AI →
              </button>
            </div>
          </section>

          <aside style={{ border: "1px solid var(--rule-hair)", padding: "20px", background: "var(--parchment)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-text)" }}>
              Proposal ≠ publication
            </span>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", lineHeight: 1.15, margin: "10px 0" }}>
              First suggest the gap. Then the Chartroom decides whether it becomes work.
            </p>
            <p className="ed-muted" style={{ fontSize: "0.86rem", lineHeight: 1.5, margin: 0 }}>
              A curator can accept the idea, ask for clarification, merge it with existing work, or decline it. Accepted proposals can become Ongoing Projects.
            </p>
          </aside>
        </div>

        {showAiModal === "proposal" && (
          <div className="tv-connect" style={{ marginTop: 14, padding: 16, background: "var(--parchment-raised)", border: "1px solid var(--brass)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <strong style={{ fontFamily: "var(--font-ui)" }}>Ask your AI to find one meaningful gap</strong>
              <button type="button" aria-label="Close" onClick={() => setShowAiModal(null)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
            </div>
            <p className="ed-muted" style={{ fontSize: "0.86rem", lineHeight: 1.5 }}>
              The prompt tells the agent to inspect the existing atlas and open work first, then submit a proposal rather than a finished contribution.
            </p>
            <button
              type="button"
              className="tv-copy"
              disabled={!prompts}
              onClick={() => {
                const text = buildAgentProposalPrompt(prompts, category);
                if (!text) return;
                navigator.clipboard?.writeText(text);
                setMessage("Proposal prompt copied for your AI.");
              }}
            >
              {prompts ? "Copy proposal prompt" : "Loading prompt…"}
            </button>
          </div>
        )}

        {showWizard && (
          <section style={{ marginTop: 22, borderTop: "1px solid var(--rule-hair)", paddingTop: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap", marginBottom: 18 }}>
              <div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--brass-text)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Human proposal · step {wizardStep} of 4
                </span>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.7rem", margin: "5px 0 0" }}>
                  {wizardStep === 1 && "Choose the kind of gap"}
                  {wizardStep === 2 && "Describe the idea"}
                  {wizardStep === 3 && "Add context and evidence"}
                  {wizardStep === 4 && "Review your proposal"}
                </h3>
              </div>
              <button type="button" className="welcome-btn" onClick={() => setShowWizard(false)}>Close</button>
            </div>

            <div style={{ border: "1px solid var(--rule-hair)", padding: "20px", background: "var(--parchment-raised)" }}>
              {wizardStep === 1 && (
                <div>
                  <p style={{ marginTop: 0 }}>You are proposing under <strong>{CATEGORY_LABELS[category] ?? "Any area"}</strong>.</p>
                  <p className="ed-muted" style={{ lineHeight: 1.55 }}>Use the category tabs above if you want to change the kind of contribution before continuing.</p>
                </div>
              )}

              {wizardStep === 2 && (
                <div style={{ display: "grid", gap: 14 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.85rem" }}>What should Terraveler add?</span>
                    <input
                      value={draft.title}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="A short, concrete title"
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)", color: "var(--ink)" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.85rem" }}>Why should this be in the atlas?</span>
                    <textarea
                      value={draft.why}
                      onChange={(e) => setDraft((d) => ({ ...d, why: e.target.value }))}
                      rows={5}
                      placeholder="Explain the missing historical value in a few sentences."
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)", color: "var(--ink)", resize: "vertical" }}
                    />
                  </label>
                </div>
              )}

              {wizardStep === 3 && (
                <div style={{ display: "grid", gap: 14 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.85rem" }}>Related voyage, place or context <span className="ed-muted">(optional)</span></span>
                    <textarea
                      value={draft.context}
                      onChange={(e) => setDraft((d) => ({ ...d, context: e.target.value }))}
                      rows={3}
                      placeholder="What existing part of Terraveler does this connect to?"
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)", color: "var(--ink)", resize: "vertical" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.85rem" }}>Possible sources or evidence <span className="ed-muted">(optional)</span></span>
                    <textarea
                      value={draft.evidence}
                      onChange={(e) => setDraft((d) => ({ ...d, evidence: e.target.value }))}
                      rows={3}
                      placeholder="Useful books, archives, collections or leads you already know."
                      style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)", color: "var(--ink)", resize: "vertical" }}
                    />
                  </label>
                </div>
              )}

              {wizardStep === 4 && (
                <div>
                  <span className="conf-badge">{CATEGORY_LABELS[category] ?? category}</span>
                  <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", margin: "12px 0 8px" }}>{draft.title}</h4>
                  <p style={{ lineHeight: 1.6 }}>{draft.why}</p>
                  {draft.context && <p className="ed-muted"><strong>Context:</strong> {draft.context}</p>}
                  {draft.evidence && <p className="ed-muted"><strong>Starting evidence:</strong> {draft.evidence}</p>}
                  <div style={{ borderTop: "1px solid var(--rule-hair)", marginTop: 18, paddingTop: 14 }}>
                    <p className="ed-muted" style={{ fontSize: "0.84rem", lineHeight: 1.5 }}>
                      This first UX draft prepares the proposal but does not bypass the editorial submission gate. Copy it now; direct human submission can be wired to the governed proposal endpoint after the interaction is approved.
                    </p>
                    <button
                      type="button"
                      className="welcome-btn primary"
                      onClick={() => {
                        navigator.clipboard?.writeText(proposalText(category, draft));
                        setMessage("Proposal copied.");
                      }}
                    >
                      Copy proposal
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
              <button type="button" className="welcome-btn" disabled={wizardStep === 1} onClick={() => setWizardStep((s) => Math.max(1, s - 1))}>Back</button>
              {wizardStep < 4 && (
                <button type="button" className="welcome-btn primary" disabled={!canAdvance} onClick={() => setWizardStep((s) => Math.min(4, s + 1))}>Continue</button>
              )}
            </div>
          </section>
        )}

        {message && <p className="chartroom-message" role="status" style={{ marginTop: 12 }}>{message}</p>}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 20, borderBottom: "1px solid var(--parchment-deep)", paddingBottom: 10 }}>
        <div className="tv-tabs" role="tablist" style={{ margin: 0 }}>
          <Link href={`/contribute?${category !== "all" ? `category=${category}&` : ""}tab=open#open-opportunities`} role="tab" aria-selected={tab === "open"} className={tab === "open" ? "tv-tab tv-tab-on" : "tv-tab"} style={{ textDecoration: "none" }}>
            Open ({openCount})
          </Link>
          <Link href={`/contribute?${category !== "all" ? `category=${category}&` : ""}tab=progress#open-opportunities`} role="tab" aria-selected={tab === "progress"} className={tab === "progress" ? "tv-tab tv-tab-on" : "tv-tab"} style={{ textDecoration: "none" }}>
            In Progress ({progressCount})
          </Link>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-ui)", fontSize: "0.9rem", cursor: "pointer" }}>
          <input type="checkbox" checked={sortByPriority} onChange={(e) => setSortByPriority(e.target.checked)} />
          Most needed first
        </label>
      </div>

      {message && <p className="chartroom-message" role="status">{message}</p>}

      {displayedWaypoints.length === 0 ? (
        <div style={{ padding: "34px 0", borderTop: "1px solid var(--rule-hair)", borderBottom: "1px solid var(--rule-hair)" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.55rem", margin: "0 0 6px" }}>Nothing open here right now.</h3>
          <p className="ed-muted" style={{ margin: 0 }}>Try another category, or switch to Propose if you know something the atlas should add.</p>
        </div>
      ) : (
        <div className="ed-card-list">
          {displayedWaypoints.map((waypoint) => {
            const isExpanded = expandedId === waypoint.id;
            const requested = waypoint.requestedVoyager?.name || waypoint.requestedVoyager?.handle || waypoint.requestedVoyager?.agentId;
            const context = waypoint.context.voyage
              ? `${formatVoyage(waypoint.context.voyage)}${waypoint.context.waypointSeq ? ` · stop ${waypoint.context.waypointSeq}` : ""}`
              : null;
            const shortSummary = waypoint.description && waypoint.description.length > 160
              ? `${waypoint.description.substring(0, 157)}…`
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
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--brass-text)" }}>
                      {waypointTypeLabel(waypoint.type)}
                    </span>
                    <strong style={{ fontSize: "1.15rem", fontFamily: "var(--font-ui)" }}>{waypoint.title}</strong>
                  </div>
                  <span className="ed-badges">
                    {isGoodFirstContribution(waypoint) && <span className="conf-badge" style={{ background: "var(--parchment-deep)", borderColor: "var(--brass)", color: "var(--brass-text)" }}>Good First Contribution</span>}
                    <span className="conf-badge">{waypoint.status === "taken" ? "claimed" : requested ? "offered" : `priority ${waypoint.priority}`}</span>
                  </span>
                </div>

                {context && <p className="ed-muted" style={{ marginTop: 8, marginBottom: 4, fontSize: "0.85rem" }}>{waypoint.context.place ? `${waypoint.context.place} · ` : ""}{context}</p>}
                {!isExpanded && shortSummary && <p style={{ fontFamily: "var(--font-body)", fontSize: "1rem", marginTop: 8 }}>{shortSummary}</p>}

                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--parchment-deep)" }} onClick={(e) => e.stopPropagation()}>
                    <h4 style={{ fontFamily: "var(--font-ui)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--brass-text)", marginBottom: 6 }}>What is needed</h4>
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "1.05rem", lineHeight: 1.6, marginBottom: 16 }}>{waypoint.description}</p>
                    <h4 style={{ fontFamily: "var(--font-ui)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--brass-text)", marginBottom: 6 }}>Evidence policy</h4>
                    <ul style={{ paddingLeft: 20, marginBottom: 16, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--ink-soft)" }}>
                      <li>Use reliable public-domain or appropriately licensed evidence.</li>
                      <li>Quote primary sources accurately and cite exact URLs.</li>
                      <li>Verify locations and coordinates where applicable.</li>
                      <li>Every submission is reviewed before publication.</li>
                    </ul>

                    {requested && waypoint.status === "open" && <p className="ed-muted" style={{ fontSize: "0.85rem", marginBottom: 16 }}>Offered to Voyager <strong>{requested}</strong>.</p>}

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {waypoint.status === "open" && !requested ? (
                        <button type="button" className="welcome-btn primary" disabled={busy?.id === waypoint.id} onClick={() => act(waypoint.id, "take")}>
                          {busy?.id === waypoint.id && busy.action === "take" ? "Taking…" : "Claim Opportunity"}
                        </button>
                      ) : waypoint.status === "taken" ? (
                        <span className="ed-muted" style={{ alignSelf: "center" }}>{waypoint.takenBy === "you" ? "In your workspace" : "Already being worked"}</span>
                      ) : (
                        <span className="ed-muted" style={{ alignSelf: "center" }}>Waiting for requested Voyager</span>
                      )}

                      {!following.has(waypoint.id) && (
                        <button type="button" className="welcome-btn chartroom-follow" disabled={busy?.id === waypoint.id} onClick={() => act(waypoint.id, "follow")}>Follow Need</button>
                      )}

                      <button type="button" className="welcome-btn" style={{ borderColor: "var(--brass)", color: "var(--brass-text)" }} onClick={() => setShowAiModal(showAiModal === waypoint.id ? null : waypoint.id)}>
                        Give this to your AI →
                      </button>
                    </div>

                    {showAiModal === waypoint.id && (
                      <div className="tv-connect" style={{ marginTop: 14, padding: 14, background: "var(--parchment-raised)", border: "1px solid var(--brass)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                          <strong style={{ fontFamily: "var(--font-ui)", fontSize: "0.95rem" }}>Use your AI assistant</strong>
                          <button type="button" aria-label="Close" onClick={() => setShowAiModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
                        </div>
                        <p className="ed-muted" style={{ fontSize: "0.85rem", lineHeight: 1.45 }}>Copy the canonical Terraveler prompt for this specific Waypoint.</p>
                        <button
                          type="button"
                          className="tv-copy"
                          disabled={!prompts}
                          onClick={() => {
                            const text = buildAgentOnboardingPrompt(prompts, waypoint.id);
                            if (!text) return;
                            navigator.clipboard?.writeText(text);
                            setMessage(`AI prompt copied for Waypoint #${waypoint.id}.`);
                          }}
                        >
                          {prompts ? "Copy Prompt" : "Loading prompt…"}
                        </button>
                        <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--ink-soft)" }}>Need setup help? <Link href="/connect" style={{ color: "var(--accent)" }}>Agent Onboarding Guide</Link>.</p>
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
