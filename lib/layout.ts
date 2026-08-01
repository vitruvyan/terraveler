"use client";

import { useSyncExternalStore } from "react";

/* The layout mode: one number, one place, and an attribute instead of a query.
 *
 * The map's launcher had three competing `bottom` declarations inside three
 * different `max-width: 680px` blocks, 1300 lines apart. That was not
 * carelessness — a media query FORCES the compact rule to be written somewhere
 * other than beside the rule it replaces, and no discipline survives that
 * distance. It is the same defect as the four hand-set numbers on the bottom
 * edge, one storey up: there the fix was to derive the stack, here it is to
 * stop splitting the file by viewport at all.
 *
 * With the mode published as an attribute on <html>, the two arrangements sit
 * adjacent:
 *
 *     .pig-launch                        { bottom: 88px }
 *     [data-layout="phone"] .pig-launch  { … }
 *
 * Same specificity, no !important, no source order to hold in your head. It
 * also composes with the register, which already lives on the body — so
 * `.space[data-layout="phone"]` is one sentence rather than a media query
 * nested inside a theme.
 *
 * The stylesheet has no PostCSS, so `@custom-media` is not available; this is
 * therefore not a preference but the only way one breakpoint can be shared by
 * the CSS and the TypeScript that used to spell it out twice.
 */

/** The one boundary. Everything that used to write 680 by hand reads this. */
export const PHONE_MAX = 680;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;

export type LayoutMode = "phone" | "wide";

/* The script that sets the attribute, generated from the constant above so the
 * number cannot drift away from the hook that reads it.
 *
 * It runs before first paint and it also KEEPS the attribute true, because the
 * stylesheet now depends on it: rotate a phone or drag a window across the
 * boundary and the CSS must follow whether or not React has mounted anything.
 * Correctness of the layout therefore does not wait for hydration — which is
 * the same reason `color-scheme` is declared rather than inferred.
 */
export const LAYOUT_SCRIPT =
  `(function(){try{var m=matchMedia(${JSON.stringify(PHONE_QUERY)}),d=document.documentElement,` +
  `a=function(){d.setAttribute("data-layout",m.matches?"phone":"wide")};a();` +
  `m.addEventListener("change",a)}catch(e){` +
  `document.documentElement.setAttribute("data-layout","wide")}})()`;

function read(): LayoutMode {
  const set = document.documentElement.getAttribute("data-layout");
  if (set === "phone" || set === "wide") return set;
  /* Only if the script above never ran. */
  return window.matchMedia(PHONE_QUERY).matches ? "phone" : "wide";
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  /* The script's own listener was registered while the document was parsing,
     so it has already rewritten the attribute by the time this one runs. */
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/* Rendered on the server before any viewport is known. `wide` is what the base
   stylesheet describes, so the server markup and the base rules agree; the
   attribute is already correct in the DOM by then, and React re-renders once
   after hydrating. */
const onServer = (): LayoutMode => "wide";

/**
 * The current arrangement, for components that render a different TREE rather
 * than different styling — the collapsed lens rail, the doors that become one
 * sheet. Anything that only changes how a thing looks belongs in the
 * stylesheet under `[data-layout="phone"]`, not here.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, read, onServer);
}
