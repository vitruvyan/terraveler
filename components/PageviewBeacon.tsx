"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/* Fires once per path change (including the first load), never blocks or
 * breaks navigation — best-effort, matching recordMiss()'s philosophy.
 * Skips the desk's own tool and the design specimen: neither is a reader.
 *
 * document.referrer reflects the ORIGINAL document load, not the previous
 * client-side route, so an internal navigation reports the same
 * referrer_host as the page before it — that's correct: the question is
 * "where did this visit come from", not "what page came before this one". */
const SKIP_PREFIXES = ["/desk", "/specimen"];

export default function PageviewBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;

    let referrer_host: string | null = null;
    try {
      if (document.referrer) referrer_host = new URL(document.referrer).hostname || null;
    } catch {
      /* malformed or opaque referrer — leave it null */
    }

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ path: pathname, referrer_host }),
    }).catch(() => {
      /* a reader must never see a broken page over this */
    });
  }, [pathname]);

  return null;
}
