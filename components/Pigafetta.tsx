"use client";

import { useEffect, useRef, useState } from "react";
import DraggableWindow from "@/components/DraggableWindow";

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
                      {s.type === "image" ? "🖼 " : ""}
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
        {hover && (
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
        <button className="pig-pill" onClick={() => setOpen(true)}>
          ⚓ Ask Pigafetta
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
