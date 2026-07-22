"use client";

import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent, ReactNode } from "react";

/**
 * A floating, draggable window with a title bar (minimize + close).
 * Positioned absolutely inside its nearest positioned ancestor.
 * Reuse this for every floating panel — do not hand-roll new ones.
 */
export default function DraggableWindow({
  title,
  children,
  onClose,
  width = 360,
  initial,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  width?: number;
  /** Initial anchor before any drag (e.g. { left: 14, top: 64 }). Defaults to top-right. */
  initial?: { left?: number; top?: number; right?: number; bottom?: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  function parentRect(): DOMRect | null {
    const parent = (ref.current?.offsetParent as HTMLElement | null) ?? null;
    return parent?.getBoundingClientRect() ?? null;
  }

  function onPointerDown(e: RPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".win-btn")) return; // let controls click
    if (window.innerWidth <= 680) return; // mobile: fixed bottom sheet, no dragging
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pr = parentRect();
    setPos({ left: rect.left - (pr?.left ?? 0), top: rect.top - (pr?.top ?? 0) });
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: RPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const el = ref.current;
    if (!el) return;
    const pr = parentRect();
    let left = e.clientX - (pr?.left ?? 0) - drag.current.dx;
    let top = e.clientY - (pr?.top ?? 0) - drag.current.dy;
    if (pr) {
      left = Math.max(0, Math.min(left, pr.width - el.offsetWidth));
      top = Math.max(0, Math.min(top, pr.height - 36));
    }
    setPos({ left, top });
  }

  function onPointerUp(e: RPointerEvent<HTMLDivElement>) {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  const style: CSSProperties = pos
    ? { left: pos.left, top: pos.top, width }
    : { ...(initial ?? { right: 16, top: 16 }), width };

  return (
    <div ref={ref} className="win" style={{ position: "absolute", ...style }}>
      <div
        className="win-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="win-title">{title}</span>
        <span className="win-ctrls">
          <button
            className="win-btn"
            onClick={() => setMinimized((m) => !m)}
            aria-label={minimized ? "Expand" : "Minimize"}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? "▢" : "–"}
          </button>
          {onClose && (
            <button className="win-btn" onClick={onClose} aria-label="Close" title="Close">
              ×
            </button>
          )}
        </span>
      </div>
      {!minimized && <div className="win-body">{children}</div>}
    </div>
  );
}
