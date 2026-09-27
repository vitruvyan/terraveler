"use client";

import { useEffect, useState } from "react";

import { Carrack, CompassRose, Fleuron, SeaSerpent, WindHead } from "@/components/WelcomeEngraving";

/* The homepage invitation.
 *
 * It is the first thing a person sees, so it is the one surface that has to
 * say what Terraveler is before it asks for anything — and then get out of the
 * way. It is a printed title-plate: an engraved frame, an ocean in the gutters
 * either side of the words, and two doors at the foot of it.
 *
 * The plate used to carry a photograph of a real antique map behind the text,
 * one of six at random, washed back to two thirds. It was doing two jobs at
 * once and neither well: the type sat on a field of other people's type, and
 * the ornament that was supposed to frame the invitation was six emoji. The
 * decoration is drawn now (components/WelcomeEngraving.tsx) and the ground is
 * plain parchment, which is what lets the drawing read at all.
 */

const SEEN_KEY = "tv-welcome-seen";
const ALWAYS_KEY = "tv-welcome-always";

export default function WelcomeCartouche() {
  const [open, setOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [alwaysShow, setAlwaysShow] = useState(true);

  useEffect(() => {
    const on = (e: Event) => setAtlasOpen(Boolean((e as CustomEvent).detail));
    window.addEventListener("tv:atlas", on);
    return () => window.removeEventListener("tv:atlas", on);
  }, []);

  useEffect(() => {
    try {
      // Absent means never decided, and defaults to showing every visit —
      // the person has to opt out, not in. Only an explicit "0" turns it off.
      const alwaysRaw = localStorage.getItem(ALWAYS_KEY);
      const always = alwaysRaw === null ? true : alwaysRaw === "1";
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
      localStorage.setItem(ALWAYS_KEY, checked ? "1" : "0");
    } catch {}
  };

  if (!open || atlasOpen) return null;

  return (
    <aside className="welcome-cart" role="dialog" aria-modal="false" aria-label="Welcome to Terraveler">
      {/* The ocean the words are printed on. Behind everything, and silent. */}
      <div className="welcome-scene" aria-hidden="true">
        <WindHead className="ws-wind ws-wind-nw" />
        <WindHead className="ws-wind ws-wind-ne" />
        <CompassRose className="ws-rose" />
        <span className="ws-inscription ws-west">Oceanvs<br />Terrarvm</span>
        <span className="ws-inscription ws-east">Mvndi<br />Conivnctio</span>
        <Carrack className="ws-ship" />
        <SeaSerpent className="ws-serpent" />
      </div>

      {/* The frame, and the four roses and two crests that break it. */}
      <div className="welcome-frame" aria-hidden="true">
        <CompassRose className="wf-rose wf-nw" />
        <CompassRose className="wf-rose wf-ne" />
        <CompassRose className="wf-rose wf-sw" />
        <CompassRose className="wf-rose wf-se" />
        <span className="wf-crest wf-north"><Fleuron /></span>
        <span className="wf-crest wf-south"><CompassRose /></span>
      </div>

      <button className="welcome-x" aria-label="Close invitation" onClick={dismiss}>×</button>

      <div className="welcome-plate">
        <div className="welcome-kicker">Welcome to Terraveler</div>
        <div className="welcome-ornament" aria-hidden="true"><Fleuron /></div>

        <h2 className="welcome-title">A living atlas of worlds, journeys and time.</h2>
        <p className="welcome-subtitle">Explore what happened, what was imagined, and what is unfolding now.</p>

        <div className="welcome-rule" aria-hidden="true"><Fleuron /></div>

        <p className="welcome-body">
          Terraveler brings <strong>maps, stories, people and sources</strong> together in one living atlas.
          Humans and AI agents can both help expand it; evidence stays visible and publication remains reviewed.
        </p>

        <div className="welcome-actions">
          <a
            className="welcome-choice primary"
            href={`/login?next=${encodeURIComponent("/contribute")}`}
            onClick={rememberSeen}
          >
            <strong>I want to contribute</strong>
            <span>Sign in, then work in the atlas yourself</span>
          </a>
          <a
            className="welcome-choice"
            href={`/login?next=${encodeURIComponent("/contribute?mode=agent-setup")}`}
            onClick={rememberSeen}
          >
            <strong>I want my agent to contribute</strong>
            <span>Sign in, then connect Claude, ChatGPT or another agent</span>
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
          <span className="welcome-foot-mark" aria-hidden="true"><Fleuron /></span>
          <button
            type="button"
            className="welcome-note"
            onClick={dismiss}
            style={{ border: "none", background: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textDecoration: "underline" }}
          >
            Just exploring? Enter the atlas — no account required.
          </button>
        </div>
      </div>
    </aside>
  );
}
