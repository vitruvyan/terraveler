"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChartroomWaypoint } from "@/lib/chartroom";
import { buildAgentSourceProposalPrompt } from "@/lib/chartroom";

type SourceDraft = {
  title: string;
  author: string;
  date: string;
  sourceType: string;
  originalLanguage: string;
  editionLanguage: string;
  url: string;
  rights: string;
  relevance: string;
};

type GovernedSource = {
  id: number;
  host_pattern: string;
  match_type: string;
  status: string;
  trust_mode: string | null;
  last_verified_at?: string | null;
  next_reverification_at?: string | null;
  institution?: {
    id: number;
    slug: string;
    name: string;
    country?: string | null;
    primary_languages?: string[] | null;
  } | null;
  policy?: {
    rights_class?: string | null;
    rights_identifier?: string | null;
    reason?: string | null;
    carta_version?: string | null;
  } | null;
  collections?: Array<{
    id: number;
    name: string;
    path_prefix?: string | null;
    trust_mode?: string | null;
  }>;
};

const SOURCE_CLASSES = [
  {
    title: "Primary sources",
    body: "Journals, letters, logbooks, contemporary accounts, official records and historical maps.",
  },
  {
    title: "Scholarly sources",
    body: "Peer-reviewed research, academic monographs, critical editions and recognized historical scholarship.",
  },
  {
    title: "Institutional collections",
    body: "National archives, museums, libraries, universities and other identifiable scholarly repositories.",
  },
  {
    title: "Visual evidence",
    body: "Historical maps, engravings, paintings, photographs and material held by identifiable collections.",
  },
];

const SOURCE_NETWORKS = [
  "Project Gutenberg",
  "Internet Archive",
  "Wikisource",
  "Wikimedia Commons",
  "National archives",
  "Museums & libraries",
  "Universities",
  "Peer-reviewed scholarship",
];

const LANGUAGES = [
  "English",
  "Italian",
  "French",
  "Spanish",
  "Portuguese",
  "Dutch",
  "German",
  "Latin",
  "Other",
];

function sourceProposalText(draft: SourceDraft) {
  return `Terraveler source proposal\n\nTitle: ${draft.title}\nAuthor / institution: ${draft.author}\nDate: ${draft.date || "Not specified"}\nType: ${draft.sourceType || "Not specified"}\nOriginal language: ${draft.originalLanguage || "Not specified"}\nEdition / translation language: ${draft.editionLanguage || "Not specified"}\nURL / archive identifier: ${draft.url}\nRights / access: ${draft.rights || "Not specified"}\n\nWhy this source matters:\n${draft.relevance}`;
}

function prettyValue(value?: string | null) {
  if (!value) return "Not specified";
  return value.replaceAll("_", " ");
}

export default function ChartroomSources({ sourceNeeds }: { sourceNeeds: ChartroomWaypoint[] }) {
  const [showWizard, setShowWizard] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<GovernedSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceDraft>({
    title: "",
    author: "",
    date: "",
    sourceType: "",
    originalLanguage: "",
    editionLanguage: "",
    url: "",
    rights: "",
    relevance: "",
  });

  useEffect(() => {
    let active = true;
    fetch("/api/sources")
      .then(async (response) => {
        if (!response.ok) throw new Error("The governed source catalogue is temporarily unavailable.");
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setSources(Array.isArray(payload?.sources) ? payload.sources : []);
        setSourcesError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSourcesError(error instanceof Error ? error.message : "The governed source catalogue is temporarily unavailable.");
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => { active = false; };
  }, []);

  const canAdvance = useMemo(() => {
    if (step === 1) return draft.title.trim().length >= 4 && draft.author.trim().length >= 2;
    if (step === 2) return draft.originalLanguage.trim().length >= 2 && draft.url.trim().length >= 8;
    if (step === 3) return draft.relevance.trim().length >= 20;
    return true;
  }, [draft, step]);

  return (
    <div style={{ marginTop: 8 }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.25fr) minmax(260px, .75fr)",
          gap: 18,
          alignItems: "stretch",
        }}
      >
        <div className="ed-panel" style={{ padding: 24, background: "var(--parchment-raised)", borderLeft: "4px solid var(--brass)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brass-text)" }}>
            Knowledge sources
          </span>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.9rem, 4vw, 2.6rem)", lineHeight: 1.05, margin: "8px 0 10px" }}>
            Explore the evidence behind the atlas.
          </h3>
          <p className="ed-muted" style={{ maxWidth: 760, lineHeight: 1.65, margin: 0 }}>
            Terraveler builds historical knowledge from identifiable, reviewable evidence. Sources are not decoration around the story: they are the foundation that lets a visitor, curator or agent ask where a claim came from.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
            <button type="button" className="welcome-btn primary" onClick={() => setShowWizard(true)}>
              Propose a source
            </button>
            <button type="button" className="welcome-btn" onClick={() => setShowAi((v) => !v)} style={{ borderColor: "var(--brass)", color: "var(--brass-text)" }}>
              Give this to your AI →
            </button>
          </div>
        </div>

        <aside style={{ border: "1px solid var(--rule-hair)", padding: 20, background: "var(--parchment)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
            Language policy
          </span>
          <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", lineHeight: 1.1, margin: "9px 0" }}>
            Evidence can speak any language.
          </h4>
          <p className="ed-muted" style={{ fontSize: "0.88rem", lineHeight: 1.55, margin: 0 }}>
            Sources may be in any language. Terraveler currently publishes narrative content in English, so we record the original language separately from the edition or translation consulted.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
            {LANGUAGES.map((language) => (
              <span key={language} className="conf-badge" style={{ background: "transparent", borderColor: "var(--rule-hair)" }}>{language}</span>
            ))}
          </div>
        </aside>
      </section>

      {showAi && (
        <section className="tv-connect" style={{ marginTop: 14, padding: 16, background: "var(--parchment-raised)", border: "1px solid var(--brass)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <strong style={{ fontFamily: "var(--font-ui)" }}>Ask your AI to discover one admissible source</strong>
            <button type="button" aria-label="Close" onClick={() => setShowAi(false)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
          </div>
          <p className="ed-muted" style={{ fontSize: "0.86rem", lineHeight: 1.5 }}>
            The prompt now follows the dedicated Source Governance path: inspect governed sources, avoid duplicate proposals, then use <code>suggest_source</code>.
          </p>
          <button
            type="button"
            className="tv-copy"
            onClick={() => {
              navigator.clipboard?.writeText(buildAgentSourceProposalPrompt());
              setMessage("Source-discovery prompt copied.");
            }}
          >
            Copy source prompt
          </button>
        </section>
      )}

      {message && <p role="status" className="chartroom-message">{message}</p>}

      <section style={{ marginTop: 30 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
          Governed catalogue
        </span>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.7rem, 4vw, 2.3rem)", margin: "6px 0 8px" }}>
          Sources Terraveler currently trusts.
        </h3>
        <p className="ed-muted" style={{ margin: "0 0 16px", lineHeight: 1.55, maxWidth: 760 }}>
          This is the live Source Governance registry: the endpoints and collections Terraveler may consult, together with their trust mode and rights policy. It is not yet a catalogue of every individual book, page or image used by the atlas.
        </p>

        {sourcesLoading ? (
          <p className="ed-muted">Loading governed sources…</p>
        ) : sourcesError ? (
          <p className="ed-muted">{sourcesError}</p>
        ) : sources.length === 0 ? (
          <p className="ed-muted">No active governed source endpoints are currently exposed.</p>
        ) : (
          <div className="ed-card-list">
            {sources.map((source) => (
              <article key={source.id} className="ed-roadmap-card">
                <div className="ed-card-head" style={{ alignItems: "flex-start" }}>
                  <div>
                    <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brass-text)", marginBottom: 4 }}>
                      {source.institution?.name ?? "Governed source"}
                    </span>
                    <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", fontWeight: 500 }}>{source.host_pattern}</strong>
                  </div>
                  <span className="conf-badge">{prettyValue(source.trust_mode)}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                  {source.policy?.rights_class && <span className="conf-badge">{prettyValue(source.policy.rights_class)}</span>}
                  {source.policy?.rights_identifier && <span className="conf-badge">{source.policy.rights_identifier}</span>}
                  {source.institution?.primary_languages?.map((language) => <span key={language} className="conf-badge">{language}</span>)}
                </div>
                {source.policy?.reason && <p className="ed-muted" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{source.policy.reason}</p>}
                {source.collections && source.collections.length > 0 && (
                  <p style={{ margin: "10px 0 0", fontSize: "0.82rem", fontFamily: "var(--font-ui)" }}>
                    Collections: {source.collections.map((collection) => collection.name).join(" · ")}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
          What counts as evidence
        </span>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.7rem, 4vw, 2.3rem)", margin: "6px 0 16px" }}>
          Admissible source classes
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", borderTop: "1px solid var(--rule-hair)", borderBottom: "1px solid var(--rule-hair)" }}>
          {SOURCE_CLASSES.map((item, index) => (
            <article key={item.title} style={{ padding: "18px 18px 20px 0", marginRight: index < SOURCE_CLASSES.length - 1 ? 18 : 0, borderRight: index < SOURCE_CLASSES.length - 1 ? "1px solid var(--rule-hair)" : "none" }}>
              <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", margin: "0 0 8px" }}>{item.title}</h4>
              <p className="ed-muted" style={{ fontSize: "0.86rem", lineHeight: 1.5, margin: 0 }}>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, .7fr)", gap: 18 }}>
        <div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
            Where Terraveler looks
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {SOURCE_NETWORKS.map((source) => (
              <span key={source} className="conf-badge" style={{ background: "var(--parchment-raised)", borderColor: "var(--rule-hair)" }}>{source}</span>
            ))}
          </div>
          <p className="ed-muted" style={{ fontSize: "0.86rem", lineHeight: 1.55, marginTop: 14 }}>
            A repository name alone does not make a claim reliable. Terraveler records the specific work, edition, author or institution, date, URL or archive identifier, language and rights context used for the evidence.
          </p>
        </div>

        <aside style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 16 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)" }}>
            Not evidence by itself
          </span>
          <p style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", lineHeight: 1.2, margin: "8px 0 0" }}>
            Search snippets, unattributed webpages, anonymous blogs, AI-generated summaries and unsourced social posts do not support historical claims.
          </p>
        </aside>
      </section>

      {sourceNeeds.length > 0 && (
        <section style={{ marginTop: 34, paddingTop: 24, borderTop: "1px solid var(--rule-hair)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
            Source work already identified
          </span>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.7rem", margin: "6px 0 14px" }}>The atlas still needs help here.</h3>
          <div className="ed-card-list">
            {sourceNeeds.slice(0, 6).map((wp) => (
              <article key={wp.id} className="ed-roadmap-card">
                <div className="ed-card-head">
                  <strong>{wp.title}</strong>
                  <span className="conf-badge">{wp.status === "taken" ? "in progress" : "open"}</span>
                </div>
                {wp.description && <p className="ed-muted" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>{wp.description}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {showWizard && (
        <section style={{ marginTop: 30, borderTop: "1px solid var(--rule-hair)", paddingTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--brass-text)" }}>
                Source proposal · step {step} of 4
              </span>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.7rem", margin: "5px 0 0" }}>
                {step === 1 && "Identify the source"}
                {step === 2 && "Record language and provenance"}
                {step === 3 && "Explain why it matters"}
                {step === 4 && "Review the proposal"}
              </h3>
            </div>
            <button type="button" className="welcome-btn" onClick={() => setShowWizard(false)}>Close</button>
          </div>

          <div style={{ border: "1px solid var(--rule-hair)", padding: 20, background: "var(--parchment-raised)" }}>
            {step === 1 && (
              <div style={{ display: "grid", gap: 14 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Title</span>
                  <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Exact title of the work or collection" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Author or institution</span>
                  <input value={draft.author} onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))} placeholder="Author, archive, museum, library…" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}><span>Date</span><input value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} placeholder="e.g. 1771" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
                  <label style={{ display: "grid", gap: 6 }}><span>Source type</span><input value={draft.sourceType} onChange={(e) => setDraft((d) => ({ ...d, sourceType: e.target.value }))} placeholder="Journal, archive, monograph…" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}><span>Original language</span><input value={draft.originalLanguage} onChange={(e) => setDraft((d) => ({ ...d, originalLanguage: e.target.value }))} placeholder="French, Spanish, Latin…" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
                  <label style={{ display: "grid", gap: 6 }}><span>Edition / translation language</span><input value={draft.editionLanguage} onChange={(e) => setDraft((d) => ({ ...d, editionLanguage: e.target.value }))} placeholder="If different" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
                </div>
                <label style={{ display: "grid", gap: 6 }}><span>Stable URL or archive identifier</span><input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://… or catalogue/signature reference" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
                <label style={{ display: "grid", gap: 6 }}><span>Rights / access status</span><input value={draft.rights} onChange={(e) => setDraft((d) => ({ ...d, rights: e.target.value }))} placeholder="Public domain, CC licence, archive access…" style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)" }} /></label>
              </div>
            )}

            {step === 3 && (
              <label style={{ display: "grid", gap: 6 }}>
                <span>What would this source strengthen?</span>
                <textarea value={draft.relevance} onChange={(e) => setDraft((d) => ({ ...d, relevance: e.target.value }))} rows={6} placeholder="Name the voyage, place, encounter, topic or disputed claim and explain why this source is useful." style={{ padding: "10px 12px", border: "1px solid var(--rule-hair)", background: "var(--parchment)", resize: "vertical" }} />
              </label>
            )}

            {step === 4 && <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-body)", lineHeight: 1.55, margin: 0 }}>{sourceProposalText(draft)}</pre>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <button type="button" className="welcome-btn" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>Back</button>
              {step < 4 ? (
                <button type="button" className="welcome-btn primary" disabled={!canAdvance} onClick={() => setStep((s) => Math.min(4, s + 1))}>Continue</button>
              ) : (
                <button
                  type="button"
                  className="welcome-btn primary"
                  onClick={() => {
                    navigator.clipboard?.writeText(sourceProposalText(draft));
                    setMessage("Source proposal copied. Human submission wiring remains intentionally separate from the agent MCP path for this UX pass.");
                  }}
                >
                  Copy proposal
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
