"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

/* The specimen chapters are long — the type chapter runs past six thousand
 * pixels — so getting back to the table of contents meant a scroll or a
 * keyboard shortcut you had to know.
 *
 * It only appears once there is somewhere to go back to, because a control
 * that does nothing is worse than no control. It is one of the few things on
 * this site that genuinely floats above the page, which is the sanctioned use
 * of --elev-1.
 */
/* Which element actually scrolls.
 *
 * globals.css sets `html, body { height: 100% }` so the map can be full-bleed,
 * and the consequence is that <body> overflows inside a fixed-height <html>:
 * the body is the scroller and window.scrollY stays at 0 forever. Reading
 * window.scrollY here looked right and never fired. */
function scroller(): HTMLElement {
  const b = document.body;
  return b.scrollHeight > b.clientHeight ? b : document.documentElement;
}

export default function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(scroller().scrollTop > 700);
    onScroll();
    /* Capture on document, because a scroll event on <body> does not bubble
       to window. */
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return (
    <button
      type="button"
      className={`spec-totop ${show ? "is-shown" : ""}`}
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={() =>
        scroller().scrollTo({
          top: 0,
          /* Respect the setting rather than assume it: someone who has asked
             the system for less motion means it here too. */
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
    >
      <Icon name="arrow-up" size={15} />
      <span>top</span>
    </button>
  );
}
