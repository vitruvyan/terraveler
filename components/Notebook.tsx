"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NOTEBOOK_EVENT,
  clearNotebook,
  keepInNotebook,
  readNotebook,
  removeFromNotebook,
  type KeptItem,
} from "@/lib/notebook";

/**
 * The notebook, and the gesture that fills it.
 *
 * Selecting text inside a sourced passage raises a small action where the
 * reader is already looking — not in a corner of the screen they have to travel
 * to. Keeping a passage carries its citation with it, which is the whole point:
 * a quotation without its source is worth nothing to someone writing an essay,
 * and re-attaching it later is exactly the step people skip.
 *
 * What the dossier deliberately does NOT contain is a summary. Generating the
 * prose would make this a homework machine — the kind of tool schools block on
 * sight, and one hallucinated sentence carrying Terraveler's name would cost
 * more than the feature could ever return. It would also break Magna Carta §3.4
 * and §5: nothing leaves the atlas unverified. So the export is assembled from
 * verified fields and verbatim quotations, every line traceable, and the writing
 * stays the reader's own. That is what makes this a tool a teacher recommends
 * instead of one they ban.
 *
 * Printing rather than generating a PDF is deliberate too: the browser's own
 * print-to-PDF works on every phone, needs no dependency, and no server ever
 * sees what the reader collected.
 */

/** Only a selection inside an element carrying its provenance can be kept —
 *  see the `data-tv-source` attributes on the log's quotations. */
const SOURCE_ATTR = "data-tv-source";

interface Pending {
  text: string;
  source: string;
  sourceUrl?: string;
  stage?: string;
  x: number;
  y: number;
}

export default function Notebook({ voyageTitle }: { voyageTitle: string }) {
  const [items, setItems] = useState<KeptItem[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Read after mount, never during render: the server has no localStorage, and
  // reading it while rendering would produce a hydration mismatch.
  useEffect(() => {
    const sync = () => setItems(readNotebook());
    sync();
    window.addEventListener(NOTEBOOK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NOTEBOOK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const clearPending = useCallback(() => setPending(null), []);

  useEffect(() => {
    function onUp(e: MouseEvent | TouchEvent) {
      const target = e.target as HTMLElement | null;
      if (target && barRef.current?.contains(target)) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.rangeCount === 0 || text.length < 8) return clearPending();

      const node = sel.anchorNode;
      const host = (node instanceof Element ? node : node?.parentElement)?.closest(
        `[${SOURCE_ATTR}]`,
      ) as HTMLElement | null;
      if (!host) return clearPending();

      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPending({
        text,
        source: host.getAttribute(SOURCE_ATTR) || "Terraveler",
        sourceUrl: host.getAttribute("data-tv-source-url") || undefined,
        stage: host.getAttribute("data-tv-stage") || undefined,
        x: r.left + r.width / 2 + window.scrollX,
        y: r.top + window.scrollY,
      });
    }
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    document.addEventListener("scroll", clearPending, { passive: true });
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("scroll", clearPending);
    };
  }, [clearPending]);

  function keepPending() {
    if (!pending) return;
    keepInNotebook({
      kind: "quote",
      text: pending.text,
      source: pending.source,
      sourceUrl: pending.sourceUrl,
      stage: pending.stage,
      voyage: voyageTitle,
    });
    window.getSelection()?.removeAllRanges();
    setPending(null);
    setOpen(true);
  }

  const quotes = items.filter((i) => i.kind === "quote");
  const notes = items.filter((i) => i.kind === "note");
  const bibliography = [...new Set(items.map((i) => i.source))];

  return (
    <>
      {pending && (
        <div
          className="tv-selbar"
          role="toolbar"
          aria-label="Selection actions"
          style={{ left: pending.x, top: pending.y }}
        >
          <button type="button" onClick={keepPending}>
            Keep with its source
          </button>
        </div>
      )}

      <div className="tv-book" ref={barRef} data-open={open || undefined}>
        <button
          type="button"
          className="tv-book-bar"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Notebook <span className="tv-book-count">{items.length}</span>
          <span className="tv-book-chev" aria-hidden="true">
            {open ? "▼" : "▲"}
          </span>
        </button>

        {open && (
          <div className="tv-book-body">
            {items.length === 0 ? (
              <p className="tv-book-empty">
                Nothing kept yet. Select a passage in the log, or keep an answer from the
                margin — the citation comes with it.
              </p>
            ) : (
              <>
                <ol className="tv-book-list">
                  {items.map((i) => (
                    <li key={i.at}>
                      {i.kind === "quote" ? <em>“{i.text}”</em> : i.text}
                      <span className="tv-book-src">
                        {i.stage ? `${i.stage} · ` : ""}
                        {i.source}
                      </span>
                      <button
                        type="button"
                        className="tv-book-drop"
                        onClick={() => removeFromNotebook(i.at)}
                        aria-label="Remove from notebook"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="tv-book-actions">
                  <button type="button" className="tv-book-export" onClick={() => window.print()}>
                    Download the dossier
                  </button>
                  <button type="button" className="tv-mini" onClick={() => clearNotebook()}>
                    Clear
                  </button>
                </div>
                <p className="tv-book-fine">
                  The dossier holds your quotations with their citations and a bibliography.
                  It does not write the essay — that part is yours.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Screen-hidden, print-only. The dossier is assembled from what the
          reader kept: every line traceable to a source they can check. */}
      {items.length > 0 && (
        <section className="tv-dossier" aria-hidden="true">
          <h1>{voyageTitle}</h1>
          <p className="tv-dossier-sub">
            Research dossier assembled from Terraveler · {new Date().toLocaleDateString("en-GB")}
          </p>

          {quotes.length > 0 && (
            <>
              <h2>Quotations ({quotes.length}) — verbatim, with citations</h2>
              <ol>
                {quotes.map((i) => (
                  <li key={i.at}>
                    <blockquote>“{i.text}”</blockquote>
                    <p className="tv-dossier-src">
                      {i.stage ? `${i.stage} — ` : ""}
                      {i.source}
                      {i.sourceUrl ? ` · ${i.sourceUrl}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}

          {notes.length > 0 && (
            <>
              <h2>From the atlas ({notes.length})</h2>
              <ol>
                {notes.map((i) => (
                  <li key={i.at}>
                    {i.text}
                    <p className="tv-dossier-src">
                      {i.stage ? `${i.stage} — ` : ""}
                      {i.source}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}

          <h2>Bibliography</h2>
          <ul>
            {bibliography.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>

          <p className="tv-dossier-note">
            Sources are public domain or openly licensed. Terraveler content is published
            under CC BY-SA 4.0; quotations above are verbatim from the works cited. This
            dossier contains no summary and no essay: it is evidence, gathered for you to
            write from.
          </p>
        </section>
      )}
    </>
  );
}
