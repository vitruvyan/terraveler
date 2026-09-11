"use client";

import { useEffect, useMemo, useState } from "react";
import DraggableWindow from "@/components/DraggableWindow";
import type { MediaItem, Waypoint } from "@/lib/types";
import {
  waypointTypeLabel,
  type ChartroomWaypoint,
  type WaypointType,
} from "@/lib/chartroom";

export type ContributeContentType = "log" | "image";

type SuggestType = "source" | "image" | "coordinate" | "date";
type ContextGap = {
  key: "diary" | "date" | "confidence" | "media";
  label: string;
  type: WaypointType;
  suggestType: SuggestType;
  title: (place: string) => string;
};

type Voyager = {
  accountId: number;
  agentId: string;
  name: string;
  handle: string;
  rank: string;
};

type Assistant = { name: string; url?: (p: string) => string; open: string; carries: boolean };

const ASSISTANTS: Assistant[] = [
  { name: "Claude", carries: true, open: "https://claude.ai/new",
    url: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}` },
  { name: "ChatGPT", carries: true, open: "https://chatgpt.com/",
    url: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
  { name: "Gemini", carries: false, open: "https://gemini.google.com/app" },
];

const RAISE_TYPES: Array<{ value: WaypointType; label: string }> = [
  { value: "source", label: "Source" },
  { value: "image", label: "Image" },
  { value: "map", label: "Map / location" },
  { value: "claim", label: "Claim / fact" },
  { value: "translation", label: "Translation" },
  { value: "narrative", label: "Narrative" },
];

function computeGaps(wp: Waypoint): ContextGap[] {
  const gaps: ContextGap[] = [];
  if (!wp.diary_excerpt) {
    gaps.push({
      key: "diary",
      label: "No verified journal excerpt",
      type: "source",
      suggestType: "source",
      title: (place) => `Find a verified primary source for ${place}`,
    });
  }
  if (!wp.arrival_date) {
    gaps.push({
      key: "date",
      label: "No confirmed arrival date",
      type: "claim",
      suggestType: "date",
      title: (place) => `Verify the arrival date at ${place}`,
    });
  }
  if (wp.confidence !== "certain") {
    gaps.push({
      key: "confidence",
      label: `Coordinate is ${wp.confidence}`,
      type: "map",
      suggestType: "coordinate",
      title: (place) => `Verify the historical location of ${place}`,
    });
  }
  const mediaCount = wp.media?.length ?? 0;
  if (mediaCount < 2) {
    gaps.push({
      key: "media",
      label: mediaCount === 0 ? "No verified images" : `Only ${mediaCount} verified image`,
      type: "image",
      suggestType: "image",
      title: (place) => `Find verified historical imagery for ${place}`,
    });
  }
  return gaps;
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

function buildPrompt(opts: {
  voyageTitle: string;
  seq: number;
  place: string;
  need: string;
  type: SuggestType;
}): string {
  return `Help me research a Terraveler contribution for "${opts.voyageTitle}", stop ${opts.seq} — ${opts.place}.
What needs work: ${opts.need}.
Use a public-domain or openly licensed source that Terraveler can verify. Start with Project Gutenberg, Wikisource, Wikimedia Commons, or a verifiable institutional/Archive.org edition.
Quote verbatim, cite the exact record/source URL, never fabricate. If this is a coordinate question, include lat/lng and the gazetteer or historical-map source.
Return a concise finding plus provenance. I will check it before submitting it under my own human contributor identity.`;
}

export default function ContributePanel({
  voyageSlug,
  voyageTitle,
  waypoint,
  contentType,
  media,
  onClose,
}: {
  voyageSlug: string;
  voyageTitle: string;
  waypoint: Waypoint;
  contentType: ContributeContentType;
  media?: MediaItem;
  onClose: () => void;
}) {
  const [contextWaypoints, setContextWaypoints] = useState<ChartroomWaypoint[]>([]);
  const [voyagers, setVoyagers] = useState<Voyager[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [questionType, setQuestionType] = useState<WaypointType>("claim");

  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [ref, setRef] = useState<number | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const place =
    waypoint.place_historical &&
    waypoint.place_modern &&
    waypoint.place_historical !== waypoint.place_modern
      ? `${waypoint.place_historical} (${waypoint.place_modern})`
      : waypoint.place_historical || waypoint.place_modern || "this stop";

  const gaps = useMemo(() => computeGaps(waypoint), [waypoint]);
  const primary = contentType === "image"
    ? gaps.find((g) => g.key === "media") ?? gaps[0]
    : gaps.find((g) => g.key === "diary") ?? gaps.find((g) => g.key === "confidence") ?? gaps[0];
  const fallbackNeed = primary?.label ?? "A stronger source, translation or additional context";
  const prompt = buildPrompt({
    voyageTitle,
    seq: waypoint.seq,
    place,
    need: fallbackNeed,
    type: primary?.suggestType ?? "source",
  });

  const snippet =
    contentType === "image"
      ? media
        ? media.caption
        : waypoint.media && waypoint.media.length
          ? `${waypoint.media.length} image${waypoint.media.length === 1 ? "" : "s"} currently: ${waypoint.media
              .map((m) => m.caption)
              .join(", ")}`
          : "No images recorded yet."
      : waypoint.diary_excerpt
        ? `“${truncate(waypoint.diary_excerpt, 140)}”`
        : waypoint.event
          ? truncate(waypoint.event, 140)
          : "No journal text recorded yet.";

  async function loadContext() {
    setContextLoading(true);
    setContextError(null);
    try {
      const r = await fetch(
        `/api/chartroom/waypoints?voyage=${encodeURIComponent(voyageSlug)}` +
          `&waypoint=${encodeURIComponent(String(waypoint.seq))}`,
        { cache: "no-store" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "The Chartroom could not load this stop.");
      const nextWaypoints = Array.isArray(j?.waypoints) ? j.waypoints : [];
      const nextVoyagers = Array.isArray(j?.agents) ? j.agents : [];
      setContextWaypoints(nextWaypoints);
      setVoyagers(nextVoyagers);
      setSelectedAgentId((current) => current ?? nextVoyagers[0]?.accountId ?? null);
    } catch (e: any) {
      setContextError(String(e?.message || e));
    } finally {
      setContextLoading(false);
    }
  }

  useEffect(() => {
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voyageSlug, waypoint.seq]);

  const derivedGaps = gaps.filter(
    (gap) => !contextWaypoints.some((item) => item.type === gap.type && item.status !== "accepted"),
  );

  function draftForGap(gap: ContextGap) {
    return {
      type: gap.type,
      title: gap.title(place),
      description: `${gap.label}. Research this as one bounded, evidence-backed task for ${voyageTitle}, stop ${waypoint.seq}.`,
      context: { voyage: voyageSlug, waypoint_seq: waypoint.seq, place },
    };
  }

  async function chartroomAction(
    action: "take" | "offer" | "raise",
    options: { waypointId?: number; draft?: any } = {},
  ) {
    const key = `${action}:${options.waypointId ?? options.draft?.type ?? "new"}`;
    setBusy(key);
    setNotice(null);
    try {
      const body: any = { action, ...(options.draft ?? {}) };
      if (options.waypointId) body.waypoint_id = options.waypointId;
      if (action === "offer") {
        if (!selectedAgentId) throw new Error("Choose one of your associated Voyagers first.");
        body.agent_account_id = selectedAgentId;
      }
      const r = await fetch("/api/chartroom/waypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "The Chartroom could not record that action.");

      if (action === "take") {
        setNotice(`Waypoint #${j?.waypoint?.id ?? options.waypointId} is now in My Waypoints.`);
      } else if (action === "offer") {
        setNotice(
          `Offered to ${j?.waypoint?.agent_name ?? "your Voyager"}. It remains the agent's independent work: when it claims the Waypoint through MCP, its standing receives the credit.`,
        );
      } else {
        setNotice(`Waypoint #${j?.waypoint?.id ?? ""} added to the Chartroom.`);
        setQuestion("");
      }
      await loadContext();
    } catch (e: any) {
      setNotice(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  function requestedVoyagerName(item: ChartroomWaypoint): string | null {
    const requested = item.requestedVoyager;
    if (!requested) return null;
    return requested.name
      || voyagers.find((a) => a.accountId === requested.accountId)?.name
      || requested.agentId
      || "Voyager";
  }

  function flash(msg: string, ms = 2500) {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg((cur) => (cur === msg ? null : cur)), ms);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      flash("Copied!");
    } catch {
      flash("Couldn't copy — select the prompt manually.");
    }
  }

  async function handTo(a: Assistant) {
    if (a.url) {
      window.open(a.url(prompt), "_blank", "noopener,noreferrer");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      flash(`Prompt copied — paste it into ${a.name}.`, 4000);
    } catch {
      flash(`Couldn't copy — copy the prompt manually, then paste it into ${a.name}.`, 5000);
    }
    window.open(a.open, "_blank", "noopener,noreferrer");
  }

  async function submit() {
    if (!idea.trim() || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const r = await fetch("/api/contribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voyage: voyageSlug,
          waypoint: waypoint.seq,
          type: primary?.suggestType ?? "source",
          idea,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Could not submit.");
      setRef(typeof j?.submission_id === "number" ? j.submission_id : null);
      setSent(true);
    } catch (e: any) {
      setSendErr(String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  return (
    <DraggableWindow
      title="Contribute · Chartroom"
      onClose={onClose}
      width={380}
      initial={{ right: "min(388px, calc(100vw - 396px))", top: 68 }}
    >
      <div>
        <span style={{ fontSize: 12, color: "var(--brass)", letterSpacing: "0.08em" }}>
          {voyageTitle} · stop {waypoint.seq}
        </span>
        <h2 style={{ margin: "4px 0 2px", fontSize: "1.15rem" }}>{place}</h2>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {snippet}
        </div>
      </div>

      <section style={{ marginTop: 14 }}>
        <div className="contrib-step">Open Waypoints for this stop</div>
        <p className="contrib-hint" style={{ marginTop: 4 }}>
          These are the same work items visible in The Chartroom and, for agents, through MCP.
        </p>

        {contextLoading && <p className="ed-muted">Reading the Chartroom…</p>}
        {contextError && (
          <p className="ed-muted">
            {contextError} You can still research and submit a human contribution below.
          </p>
        )}

        {!contextLoading && !contextError && contextWaypoints.map((item) => {
          const requested = requestedVoyagerName(item);
          return (
            <article key={item.id} className="ed-roadmap-card chartroom-waypoint" style={{ marginTop: 8 }}>
              <div className="ed-card-head">
                <strong>{item.title}</strong>
                <span className="conf-badge">{waypointTypeLabel(item.type)}</span>
              </div>
              {item.description && <p>{item.description}</p>}
              {item.status === "taken" ? (
                <p className="ed-muted">Already being worked{item.takenBy ? ` by ${item.takenBy}` : ""}.</p>
              ) : requested ? (
                <p className="ed-muted">Offered to {requested}. It stays that Voyager's independent work.</p>
              ) : (
                <div className="chartroom-actions">
                  <button
                    type="button"
                    className="welcome-btn primary"
                    disabled={busy !== null}
                    onClick={() => chartroomAction("take", { waypointId: item.id })}
                  >
                    Work on this
                  </button>
                  {voyagers.length > 0 && (
                    <button
                      type="button"
                      className="welcome-btn chartroom-follow"
                      disabled={busy !== null || !selectedAgentId}
                      onClick={() => chartroomAction("offer", { waypointId: item.id })}
                    >
                      Ask a Voyager
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {!contextLoading && !contextError && derivedGaps.map((gap) => {
          const draft = draftForGap(gap);
          return (
            <article key={gap.key} className="ed-roadmap-card chartroom-waypoint" style={{ marginTop: 8 }}>
              <div className="ed-card-head">
                <strong>{draft.title}</strong>
                <span className="conf-badge">{waypointTypeLabel(gap.type)}</span>
              </div>
              <p>{gap.label}. This becomes a real Waypoint when someone takes or offers it.</p>
              <div className="chartroom-actions">
                <button
                  type="button"
                  className="welcome-btn primary"
                  disabled={busy !== null}
                  onClick={() => chartroomAction("take", { draft })}
                >
                  Work on this
                </button>
                {voyagers.length > 0 && (
                  <button
                    type="button"
                    className="welcome-btn chartroom-follow"
                    disabled={busy !== null || !selectedAgentId}
                    onClick={() => chartroomAction("offer", { draft })}
                  >
                    Ask a Voyager
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {voyagers.length > 0 ? (
          <label style={{ display: "block", marginTop: 10, fontSize: 12.5 }}>
            Voyager
            <select
              value={selectedAgentId ?? ""}
              onChange={(e) => setSelectedAgentId(Number(e.target.value) || null)}
              style={{ width: "100%", marginTop: 4, padding: 7 }}
            >
              {voyagers.map((agent) => (
                <option key={agent.accountId} value={agent.accountId}>
                  {agent.name} · {agent.rank}
                </option>
              ))}
            </select>
          </label>
        ) : !contextLoading && !contextError ? (
          <p className="contrib-hint" style={{ marginTop: 10 }}>
            No Voyager is associated with this account. <a href="/account/agents">Associate one</a>,
            or work on the Waypoint yourself.
          </p>
        ) : null}

        {notice && <p className="chartroom-message" role="status">{notice}</p>}
        <p style={{ marginTop: 10, fontSize: 12.5 }}>
          <a href={`/contribute?voyage=${encodeURIComponent(voyageSlug)}&waypoint=${waypoint.seq}`}>
            View this work in The Chartroom →
          </a>
        </p>
      </section>

      <section style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(120,90,60,0.18)" }}>
        <div className="contrib-step">Raise another question</div>
        <p className="contrib-hint" style={{ marginTop: 4 }}>
          Humans can originate knowledge work too. The question becomes an open Waypoint for any eligible contributor.
        </p>
        <select
          value={questionType}
          onChange={(e) => setQuestionType(e.target.value as WaypointType)}
          style={{ width: "100%", marginTop: 6, padding: 7 }}
        >
          {RAISE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="What is missing, uncertain or worth checking here?"
          style={{ width: "100%", marginTop: 6, boxSizing: "border-box", resize: "vertical", padding: 8 }}
        />
        <button
          type="button"
          className="welcome-btn chartroom-follow"
          disabled={busy !== null || question.trim().length < 4}
          onClick={() => chartroomAction("raise", {
            draft: {
              type: questionType,
              title: truncate(question, 160),
              description: question.trim(),
              context: { voyage: voyageSlug, waypoint_seq: waypoint.seq, place },
            },
          })}
        >
          Add Waypoint
        </button>
      </section>

      <details style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(120,90,60,0.18)" }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
          Use an assistant, but submit the work as mine
        </summary>
        <p className="contrib-hint">
          This is different from Ask a Voyager. Here an assistant only helps with research;
          you check the result and the final submission is attributed to your human contributor identity.
        </p>
        <div className="contrib-copy-row">
          <button type="button" className="contrib-copy-btn is-primary" onClick={copyPrompt}>
            Copy research prompt
          </button>
          {copyMsg && <span className="contrib-toast">{copyMsg}</span>}
        </div>
        <div className="contrib-ai-row" style={{ marginTop: 7 }}>
          {ASSISTANTS.map((a) => (
            <button key={a.name} type="button" className="contrib-ai-btn" onClick={() => handTo(a)}>
              {a.name}{!a.carries && <span className="contrib-ai-note">paste</span>}
            </button>
          ))}
        </div>
      </details>

      <section style={{ marginTop: 14 }}>
        <div className="contrib-step">Submit my finding</div>
        {sent ? (
          <div style={{ fontSize: 12.5, color: "var(--ink)", marginTop: 6, lineHeight: 1.45 }}>
            Thank you — your suggestion is on the editor&rsquo;s desk and remains attributed to you.
            {ref !== null && <> Your reference is <strong>#{ref}</strong>.</>}
          </div>
        ) : (
          <>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Write your finding — or paste research you have checked — and include the source URL."
              rows={3}
              style={{ width: "100%", marginTop: 6, boxSizing: "border-box", resize: "vertical", padding: 8 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="welcome-btn primary"
                onClick={submit}
                disabled={sending || !idea.trim()}
              >
                {sending ? "Sending…" : "Submit finding"}
              </button>
              {sendErr && <span style={{ fontSize: 11.5, color: "#b0715d" }}>{sendErr}</span>}
            </div>
          </>
        )}
      </section>
    </DraggableWindow>
  );
}
