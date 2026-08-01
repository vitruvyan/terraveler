"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { useLayoutMode } from "@/lib/layout";

/* THE MARGIN, where there is no margin.
 *
 * The basemap note is the fifth voice — the hand annotating the edge. On a
 * phone there is no edge to annotate: six lines of mono ran across the middle
 * of the map and ate 12.9% of the screen, more than any other band, to say
 * something a reader needs once. That is not a note in the margin, it is a
 * paragraph laid over the subject.
 *
 * So on a phone it is a fact you can open. The chip states the one thing worth
 * stating without being asked — which reconstruction you are looking at — and
 * the reasoning behind it is a tap away. Nothing is dropped; it stops being
 * shouted.
 *
 * It forwards a ref because useEdgeStack measures this band to stack the ones
 * below it, and a chip is a different height from a paragraph.
 */
const MapNote = forwardRef<
  HTMLDivElement,
  { className: string; label: string; children: ReactNode }
>(function MapNote({ className, label, children }, ref) {
  const phone = useLayoutMode() === "phone";
  const [open, setOpen] = useState(false);

  if (phone && !open) {
    return (
      <div className={`${className} map-note-chip`} ref={ref}>
        <button onClick={() => setOpen(true)} aria-expanded={false}>
          {label}
        </button>
      </div>
    );
  }

  return (
    <div className={className} ref={ref}>
      {phone && (
        <button className="map-note-shut" onClick={() => setOpen(false)} aria-label="Close the note">
          ×
        </button>
      )}
      {children}
    </div>
  );
});

export default MapNote;
