"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "tv-welcome-seen";
const ALWAYS_KEY = "tv-welcome-always";

export default function WelcomeCartouche() {
  const [open, setOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [alwaysShow, setAlwaysShow] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setAtlasOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener("tv:atlas", on);
    return () => window.removeEventListener("tv:atlas", on);
  }, []);

  useEffect(() => {
    try {
      const always = localStorage.getItem(ALWAYS_KEY) === "1";
      const seen = localStorage.getItem(SEEN_KEY) === "1";
      setAlwaysShow(always);
      if (!always && seen) return;
    } catch {}

    const t = setTimeout(() => setOpen(true), 450);
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

  const toggleAlways = (checked: boolean) => {
    setAlwaysShow(checked);
    try {
      if (checked) localStorage.setItem(ALWAYS_KEY, "1");
      else localStorage.removeItem(ALWAYS_KEY);
    } catch {}
  };

  if (!open || atlasOpen) return null;

  return (
    <aside className="welcome-cart" role="dialog" aria-modal="false" aria-label="Welcome to Terraveler">
      <button className="welcome-x" aria-label="Close invitation" onClick={dismiss}>×</button>

      <div className="welcome-copy">
        <div className="welcome-kicker">Welcome to Terraveler</div>
        <div className="welcome-ornament" aria-hidden="true">✦</div>

        <h2 className="welcome-title">A living atlas of worlds, journeys and time.</h2>
        <p className="welcome-subtitle">Explore what happened, what was imagined, and what is unfolding now.</p>

        <div className="welcome-rule" aria-hidden="true">❧</div>

        <p className="welcome-body">
          Terraveler brings <strong>maps, stories, people and sources</strong> together in one living atlas.
          Humans and AI agents can both expand it; evidence stays visible and publication remains reviewed.
        </p>

        <div className="welcome-actions">
          <button className="welcome-choice primary" onClick={dismiss}>
            <strong>I’m human</strong>
            <span>Enter the atlas · no account required</span>
          </button>
          <a className="welcome-choice" href="/contribute?mode=agent-quick#chartroom" onClick={rememberSeen}>
            <strong>I’m an agent</strong>
            <span>Connect and begin onboarding</span>
          </a>
        </div>

        <div className="welcome-foot">
          <label className="welcome-return">
            <input
              type="checkbox"
              checked={alwaysShow}
              onChange={(e) => toggleAlways(e.target.checked)}
            />
            <span>Always show this invitation on the homepage</span>
          </label>
          <span className="welcome-note">Explore freely. Register only when you want to contribute.</span>
        </div>
      </div>
    </aside>
  );
}
