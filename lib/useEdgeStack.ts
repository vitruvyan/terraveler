"use client";

import { useEffect, type RefObject } from "react";

/* The bottom edge of the map, as one derived stack.
 *
 * Four things anchor to that edge — the Pigafetta launcher, the map's note,
 * MapLibre's attribution and the transport bar — and each of them used to pick
 * its own `bottom` by hand. The launcher had accumulated four competing
 * declarations, one per collision somebody patched. Four numbers cannot be
 * held consistent by hand, and on a phone they were not: the note ran into
 * both the bar and the launcher, and the attribution sat underneath the bar.
 *
 * The heights are measured and published as custom properties, so the CSS can
 * stack the bands off each other instead of off a guess. The transport bar
 * wraps on a narrow screen, which makes its height a function of the content —
 * there is no constant anyone could have written down correctly.
 *
 * This lives in one file because both experience components need it, and the
 * pattern of writing the same chrome twice is exactly how the space Atlas
 * panel lost a chip and stayed lost.
 */
export function useEdgeStack(refs: {
  bar: RefObject<HTMLElement | null>;
  note: RefObject<HTMLElement | null>;
  /** The MapLibre container, when there is one. The orrery has no attribution. */
  container?: RefObject<HTMLElement | null>;
}) {
  const { bar, note, container } = refs;
  useEffect(() => {
    const root = document.documentElement;
    const ro = new ResizeObserver(() => publish());
    let attr: HTMLElement | null = null;

    function publish() {
      root.style.setProperty("--tv-bar-h", `${Math.round(bar.current?.offsetHeight ?? 0)}px`);
      root.style.setProperty("--tv-note-h", `${Math.round(note.current?.offsetHeight ?? 0)}px`);
      /* MapLibre builds its attribution itself and does it after we mount, so
         it cannot be handed a ref. It is a band like any other and is measured
         like any other — the alternative is a fifth hand-written number, which
         is the thing that broke here to begin with. */
      const found = container?.current?.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
      if (found && found !== attr) {
        attr = found;
        ro.observe(found);
      }
      root.style.setProperty("--tv-attr-h", `${Math.round(attr?.offsetHeight ?? 0)}px`);
    }

    publish();
    if (bar.current) ro.observe(bar.current);
    if (note.current) ro.observe(note.current);

    const mo = new MutationObserver(() => publish());
    if (container?.current) mo.observe(container.current, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      root.style.removeProperty("--tv-bar-h");
      root.style.removeProperty("--tv-note-h");
      root.style.removeProperty("--tv-attr-h");
    };
  }, [bar, note, container]);
}
