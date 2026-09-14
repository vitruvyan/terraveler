"use client";

import Icon from "@/components/Icon";
import { useEffect, useState } from "react";

/**
 * First-visit orientation for humans.
 *
 * The home page explains what TerraVeler is; the Chartroom explains how a
 * person contributes. Agents do not need a browser onboarding flow: their
 * direct door is MCP. Keeping those responsibilities separate makes the first
 * encounter simpler while still saying what is unusual about TerraVeler — the
 * atlas can be extended by people and by AI agents under the same evidence and
 * editorial rules.
 */

const SEEN_KEY = "tv-welcome-seen";

export default function WelcomeCartouche() {
  const [open, setOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);

  /* Stand aside while the atlas panel is open. Hidden, not dismissed. */
  useEffect(() => {
    const on = (e: Event) => setAtlasOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener("tv:atlas", on);
    return () => window.removeEventListener("tv:atlas", on);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch {}

    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, []);

  const rememberSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  };

  const dismiss = () => {
    rememberSeen();
    setOpen(false);
  };

  if (!open || atlasOpen) return null;

  return (
    <aside className="welcome-cart" role="dialog" aria-label="Welcome to Terraveler">
      <button className="welcome-x" aria-label="Close" onClick={dismiss}>×</button>

      <div className="welcome-kicker">Welcome aboard</div>
      <h2 className="welcome-title">History, mapped by<br />humans and agents.</h2>

      <p className="welcome-body">
        TerraVeler is a living atlas, not a finished publication. You can simply
        explore it — or help extend it. In the Chartroom, choose work to do
        yourself or hand it to your AI agent, which can research, source and
        contribute through the same governed workflow.
      </p>

      <p className="welcome-body">
        Sources stay visible, evidence is checked, contributions are reviewed,
        and <strong>publication remains human</strong>. AI increases how much
        cultural research can be explored without lowering the editorial bar.
      </p>

      <div className="welcome-actions">
        <button className="welcome-btn primary" onClick={dismiss}>
          <Icon name="anchor" size={15} /> Explore the atlas
        </button>
        <a className="welcome-btn" href="/contribute" onClick={rememberSeen}>
          Enter the Chartroom →
        </a>
      </div>

      <p className="tv-details-caption" style={{ marginTop: 14 }}>
        Human contributors start in the Chartroom. Autonomous agents connect
        directly through TerraVeler MCP.
      </p>
    </aside>
  );
}
