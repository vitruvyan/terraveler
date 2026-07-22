"use client";

import { useState } from "react";
import DraggableWindow from "@/components/DraggableWindow";
import type { MediaItem, Waypoint } from "@/lib/types";

export type ContributeContentType = "log" | "image";

type SuggestType = "source" | "image" | "coordinate" | "date";

interface Gap {
  key: "diary" | "date" | "confidence" | "media";
  label: string;
  type: SuggestType;
}

/** Compute the concrete gaps for THIS waypoint, straight from its data. */
function computeGaps(wp: Waypoint): Gap[] {
  const gaps: Gap[] = [];
  if (!wp.diary_excerpt) {
    gaps.push({ key: "diary", label: "no verified journal excerpt", type: "source" });
  }
  if (!wp.arrival_date) {
    gaps.push({ key: "date", label: "no confirmed arrival date", type: "date" });
  }
  if (wp.confidence !== "certain") {
    gaps.push({ key: "confidence", label: `coordinate is ${wp.confidence}`, type: "coordinate" });
  }
  const mediaCount = wp.media?.length ?? 0;
  if (mediaCount < 2) {
    gaps.push({
      key: "media",
      label: mediaCount === 0 ? "no images" : `only ${mediaCount} image${mediaCount === 1 ? "" : "s"}`,
      type: "image",
    });
  }
  return gaps;
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** Which gap (and which suggest_content type) this button's context should lead with. */
function primaryGap(contentType: ContributeContentType, gaps: Gap[]): Gap {
  if (contentType === "image") {
    return (
      gaps.find((g) => g.key === "media") ?? {
        key: "media",
        label: "more or better images for this stop",
        type: "image",
      }
    );
  }
  return (
    gaps.find((g) => g.key === "diary") ??
    gaps.find((g) => g.key === "confidence") ??
    gaps.find((g) => g.key === "date") ?? {
      key: "diary",
      label: "a stronger source or fuller context for this stop",
      type: "source",
    }
  );
}

function buildPrompt(opts: {
  voyageTitle: string;
  voyageSlug: string;
  seq: number;
  place: string;
  gapSentence: string;
  type: SuggestType;
}): string {
  return `You are connected to the Terraveler MCP. Contribute to the "${opts.voyageTitle}" voyage,
stop ${opts.seq} — ${opts.place}.
What's needed: ${opts.gapSentence}.
Find a public-domain or CC source that supplies this, then call the MCP tool
suggest_content with:
  { voyage: "${opts.voyageSlug}", waypoint: ${opts.seq}, type: "${opts.type}", idea: "<your finding + the source URL>" }
Rules: PD/CC sources only (Gutenberg, Wikisource, Wikipedia, Wikimedia Commons,
Wikidata, archive.org, Gallica, loc.gov). Quote verbatim, cite the source URL,
never fabricate. If the gap is a coordinate, propose lat/lng with the gazetteer source.`;
}

/**
 * The contextual contribution panel: scoped to one waypoint (and optionally
 * one image). Centerpiece is "Hand to your AI" — it builds a ready-made task
 * prompt (no secrets — the MCP invite code lives in the user's own connector
 * config) and opens Claude / ChatGPT / Gemini with it pre-filled.
 */
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
  /** When scoped to one specific image (Plates lens, per-thumbnail). */
  media?: MediaItem;
  onClose: () => void;
}) {
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const place =
    waypoint.place_historical &&
    waypoint.place_modern &&
    waypoint.place_historical !== waypoint.place_modern
      ? `${waypoint.place_historical} (${waypoint.place_modern})`
      : waypoint.place_historical || waypoint.place_modern || "this stop";

  const gaps = computeGaps(waypoint);
  const chosen = primaryGap(contentType, gaps);
  const gapSentence = gaps.length
    ? gaps.map((g) => g.label).join("; ")
    : "this stop already has good coverage — an additional angle, source, translation, or connection is still welcome";

  const prompt = buildPrompt({
    voyageTitle,
    voyageSlug,
    seq: waypoint.seq,
    place,
    gapSentence,
    type: chosen.type,
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

  function flash(msg: string, ms = 2500) {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg((cur) => (cur === msg ? null : cur)), ms);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      flash("Copied!");
    } catch {
      flash("Couldn't copy — select the text below manually.");
    }
  }

  function handToClaude() {
    window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, "_blank", "noopener,noreferrer");
  }

  function handToChatGPT() {
    window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, "_blank", "noopener,noreferrer");
  }

  async function handToGemini() {
    try {
      await navigator.clipboard.writeText(prompt);
      flash("Prompt copied — paste it into Gemini.", 4000);
    } catch {
      flash("Couldn't copy — use “Copy prompt” below, then paste into Gemini.", 4000);
    }
    window.open("https://gemini.google.com/app", "_blank", "noopener,noreferrer");
  }

  return (
    <DraggableWindow title="Contribute" onClose={onClose} width={340} initial={{ right: 16, top: 420 }}>
      <div>
        <span style={{ fontSize: 12, color: "var(--brass)", letterSpacing: "0.08em" }}>
          {voyageTitle} · stop {waypoint.seq} · {contentType === "image" ? "image" : "ship's log"}
        </span>
        <h2 style={{ margin: "4px 0 2px", fontSize: "1.15rem" }}>{place}</h2>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--ink-soft)",
            fontStyle: contentType === "log" ? "italic" : "normal",
            lineHeight: 1.45,
          }}
        >
          {snippet}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--brass)",
          }}
        >
          What this stop needs
        </div>
        {gaps.length ? (
          <ul className="contrib-gaps">
            {gaps.map((g) => (
              <li key={g.key}>{g.label}</li>
            ))}
          </ul>
        ) : (
          <div className="contrib-gaps-ok">
            Well documented already — an extra angle, source, or translation is still welcome.
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--brass)",
          }}
        >
          Hand to your AI
        </div>
        <div className="contrib-ai-row">
          <button type="button" className="contrib-ai-btn" onClick={handToClaude}>
            Claude
          </button>
          <button type="button" className="contrib-ai-btn" onClick={handToChatGPT}>
            ChatGPT
          </button>
          <button type="button" className="contrib-ai-btn" onClick={handToGemini}>
            Gemini
          </button>
        </div>
        <div className="contrib-copy-row">
          <button type="button" className="contrib-copy-btn" onClick={copyPrompt}>
            Copy prompt
          </button>
          {copyMsg && <span className="contrib-toast">{copyMsg}</span>}
        </div>
      </div>

      <div className="contrib-note">
        Your AI must be connected to the Terraveler MCP (set up once in your account). It will
        submit through the pipeline; the Editor authorises before anything goes live.
      </div>
    </DraggableWindow>
  );
}
