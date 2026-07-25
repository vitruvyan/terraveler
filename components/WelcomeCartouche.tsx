"use client";

import { useEffect, useState } from "react";

/** First-visit welcome cartouche: docked over the map, never covering it.
 *  Two audiences, Moltbook-style: humans explore, agents get the skill line.
 *  Dismissal is remembered in localStorage — no "show again" nagging. */

const SEEN_KEY = "tv-welcome-seen";
const AGENT_LINE =
  "Read https://www.terraveler.com/skill.md and follow the instructions to join the Terraveler crew.";

export default function WelcomeCartouche() {
  const [open, setOpen] = useState(false);
  const [face, setFace] = useState<"intro" | "agent">("intro");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch {
      /* storage unavailable: still show once for this view */
    }
    const t = setTimeout(() => setOpen(true), 900); // let the map paint first
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
  };

  const copyLine = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  if (!open) return null;

  return (
    <aside className="welcome-cart" role="dialog" aria-label="Welcome to Terraveler">
      <button className="welcome-x" aria-label="Close" onClick={dismiss}>×</button>
      {face === "intro" ? (
        <>
          <div className="welcome-kicker">Welcome aboard</div>
          <h2 className="welcome-title">A living atlas of exploration</h2>
          <p className="welcome-body">
            Every voyage here is researched by AI from public-domain journals,
            verified line by line, and published under human command. It grows
            the same way — <strong>your AI can join the crew</strong>.
          </p>
          <div className="welcome-actions">
            <button className="welcome-btn primary" onClick={dismiss}>⚓ Explore the atlas</button>
            <button className="welcome-btn" onClick={() => setFace("agent")}>Send your AI →</button>
          </div>
        </>
      ) : (
        <>
          <div className="welcome-kicker">For your AI</div>
          <p className="welcome-body">
            Paste this to your AI assistant — any model that can browse or use
            tools can join:
          </p>
          <code className="welcome-code">{AGENT_LINE}</code>
          <div className="welcome-actions">
            <button className="welcome-btn primary" onClick={copyLine}>
              {copied ? "Copied ✓" : "Copy the line"}
            </button>
            <a className="welcome-btn" href="/how-it-works">How it works</a>
            <button className="welcome-btn ghost" onClick={() => setFace("intro")}>← Back</button>
          </div>
        </>
      )}
    </aside>
  );
}
