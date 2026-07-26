"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "tv-log-hint-seen";

/**
 * Says once, on the first log a reader opens, that a passage can be taken.
 *
 * The annotation layer was built and then could not be found — including by the
 * person who asked for it. The cause is structural rather than cosmetic: the
 * question chips are deliberately rare, because an explanation repeated on
 * forty stages is noise, so Bougainville shows exactly one across fifteen
 * stages and Apollo 11 shows none. Everything else in the layer hangs off
 * selecting text, and selecting text advertises itself to nobody.
 *
 * A permanent instruction would be the wrong fix — it would sit on every log
 * forever, reading as clutter to everyone who had already understood. So this
 * appears once and remembers, the same bargain the welcome cartouche makes.
 */
export default function LogHint() {
  // Rendered only after mount and only if unseen: reading localStorage during
  // render would mismatch the server, and showing it then hiding it would be
  // worse than not showing it.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch {
      /* private mode — no hint rather than a crash */
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* nothing to do; it will simply appear again */
    }
  }

  if (!show) return null;
  return (
    <p className="tv-hint" role="note">
      <span>
        <b>Select any quoted passage</b> to keep it — its citation comes with it.
        Where a stage carries a question, the answer opens in the margin.
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss this note">
        ×
      </button>
    </p>
  );
}
