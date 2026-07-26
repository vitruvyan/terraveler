"use client";

import { useState } from "react";
import type { MarginNote } from "@/lib/marginalia";
import { keepInNotebook } from "@/lib/notebook";

/**
 * A stage's own questions, and the answers opened in the margin beside it.
 *
 * The gesture this exists to replace: notice something, hunt for the chat
 * button, open a panel over the map, then invent a question from a blank box.
 * Here the questions are already written — from the stage's own verified data
 * (see lib/marginalia.ts) — and the answer opens next to the passage that
 * provoked it, so the reader never loses their place.
 *
 * Rendered with `display: contents` so its two children land in the log's grid
 * directly: the chips under the stage, the answers in the gutter to the right.
 * On a narrow screen the gutter collapses beneath the stage and the answers
 * appear inline, which is the same reading order rather than a second design.
 */
export default function StageNotes({
  notes,
  stageLabel,
  voyageTitle,
}: {
  notes: MarginNote[];
  /** e.g. "24. Cape of the Eleven Thousand Virgins" — travels with a kept item
   *  so the notebook can say where it came from. */
  stageLabel: string;
  voyageTitle: string;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  if (notes.length === 0) return null;

  const toggle = (id: string) =>
    setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <div style={{ display: "contents" }}>
      <div className="tv-chips">
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className="tv-ask"
            aria-expanded={open.includes(n.id)}
            onClick={() => toggle(n.id)}
          >
            {n.question}
          </button>
        ))}
      </div>

      <aside className="tv-gutter">
        {notes
          .filter((n) => open.includes(n.id))
          .map((n) => (
            <div key={n.id} className={n.kind === "gap" ? "tv-note tv-note-gap" : "tv-note"}>
              <p className="tv-note-q">{n.question}</p>
              <p className="tv-note-a">{n.answer}</p>
              <p className="tv-note-cite">
                {n.citationUrl ? (
                  <a href={n.citationUrl} target="_blank" rel="noreferrer">
                    {n.citation}
                  </a>
                ) : (
                  n.citation
                )}
              </p>
              {n.contribute && (
                <a className="tv-note-contribute" href="/contribute">
                  {n.contribute} →
                </a>
              )}
              <div className="tv-note-actions">
                <button
                  type="button"
                  className="tv-mini"
                  disabled={kept.includes(n.id)}
                  onClick={() => {
                    keepInNotebook({
                      kind: "note",
                      text: `${n.question} — ${n.answer}`,
                      source: n.citation,
                      sourceUrl: n.citationUrl,
                      stage: stageLabel,
                      voyage: voyageTitle,
                    });
                    setKept((k) => [...k, n.id]);
                  }}
                >
                  {kept.includes(n.id) ? "Kept" : "Keep"}
                </button>
                <button type="button" className="tv-mini" onClick={() => toggle(n.id)}>
                  Close
                </button>
              </div>
            </div>
          ))}
      </aside>
    </div>
  );
}
