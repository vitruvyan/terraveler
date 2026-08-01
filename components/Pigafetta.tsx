"use client";

import Icon from "@/components/Icon";
import { useEffect, useRef, useState } from "react";
import DraggableWindow from "@/components/DraggableWindow";
import { useLayoutMode } from "@/lib/layout";

type Source = {
  title: string;
  source_url: string | null;
  type: string;
  media_url: string | null;
  credit: string | null;
};
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

const GREETING: Msg = {
  role: "assistant",
  content:
    "I am Antonio Pigafetta, chronicler of voyages. Ask me anything about this " +
    "voyage — I answer only from the ship's journals and sources, and cite them.",
};

const SUGGESTIONS = [
  "Why was Tahiti called New Cythera?",
  "What happened in the Strait of Magellan?",
  "Who was Jeanne Barret?",
];

function dedupe(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const k = s.title || s.source_url || "";
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out.slice(0, 6);
}

export default function Pigafetta({ voyage }: { voyage?: string }) {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const [hover, setHover] = useState(false);
  const isMobile = useLayoutMode() === "phone";
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy, open, docked]);

  async function send(preset?: string) {
    const q = (preset ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, voyage }),
      });
      const j = await r.json();
      setMsgs((m) => [
        ...m,
        j.error
          ? { role: "assistant", content: "— (" + j.error + ")" }
          : { role: "assistant", content: j.answer, sources: j.sources },
      ]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "— network error, try again." }]);
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div className="pig-chat">
      <div className="pig-msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`pig-msg pig-${m.role}`}>
            <div className="pig-bubble">{m.content}</div>
            {m.sources && m.sources.length > 0 && (
              <div className="pig-sources">
                <span className="pig-src-label">Sources</span>
                {dedupe(m.sources).map((s, j) =>
                  s.source_url ? (
                    <a key={j} href={s.source_url} target="_blank" rel="noreferrer" className="pig-src">
                      {s.type === "image" ? <Icon name="plates" size={13} /> : null}
                      {s.title}
                    </a>
                  ) : (
                    <span key={j} className="pig-src">{s.title}</span>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        {msgs.length === 1 && !busy && (
          <div className="pig-suggs">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pig-sugg" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <div className="pig-msg pig-assistant">
            <div className="pig-bubble pig-typing">Pigafetta is consulting the logs…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="pig-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Pigafetta about the voyage…"
          aria-label="Ask Pigafetta"
        />
        <button type="submit" disabled={busy} aria-label="Send">
          →
        </button>
      </form>
    </div>
  );

  // Collapsed: the pill launcher with a hover minibox.
  if (!open) {
    return (
      <div
        className="pig-launch"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Desktop only, and not because a phone has no hover — because it
            HAS one, of the worst kind. Android fires a synthetic mouseenter on
            tap and never a mouseleave, so this box opened on the first touch
            of the launcher and then stayed, a desktop teaser stuck over the
            map. Gating the stylesheet’s :hover rules did nothing for it: this
            is a JS handler, and the gate does not reach into React. On a phone
            the launcher opens the assistant full-bleed, which is the whole of
            what this box was there to promise. */}
        {hover && !isMobile && (
          <div className="pig-mini">
            <div className="pig-mini-title">Antonio Pigafetta</div>
            <div className="pig-mini-sub">Ask the voyage&rsquo;s sources — he answers citing them.</div>
            <label className="pig-dock-toggle">
              <input
                type="checkbox"
                checked={docked}
                onChange={(e) => setDocked(e.target.checked)}
              />
              Dock to the side
            </label>
          </div>
        )}
        {/* A door, so: a pill where it carries its label, round where it does
            not. On a phone it does not — a 183px pill lay across the middle of
            the route, which is the one thing the map exists to show. */}
        <button className="pig-pill" onClick={() => setOpen(true)} aria-label="Ask Pigafetta">
          <Icon name="mariner" size={19} />
          <span className="pig-pill-word">Ask Pigafetta</span>
        </button>
      </div>
    );
  }

  // Docked: a right-side panel.
  if (docked) {
    return (
      <div className="pig-dock">
        <div className="pig-dock-bar">
          <span className="win-title">Antonio Pigafetta</span>
          <span className="win-ctrls">
            <button className="win-btn" onClick={() => setDocked(false)} title="Float" aria-label="Float">
              ▭
            </button>
            <button className="win-btn" onClick={() => setOpen(false)} title="Close" aria-label="Close">
              ×
            </button>
          </span>
        </div>
        {body}
      </div>
    );
  }

  // Floating: reuse the shared window.
  return (
    <DraggableWindow title="Antonio Pigafetta" onClose={() => setOpen(false)} width={380}>
      <div className="pig-float-tools">
        <button className="pig-dock-btn" onClick={() => setDocked(true)}>
          ▸ Dock to the side
        </button>
      </div>
      {body}
    </DraggableWindow>
  );
}
