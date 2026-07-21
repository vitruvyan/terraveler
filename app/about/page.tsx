import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "About — Terraveler",
  description:
    "What Terraveler is: an authoritative, AI-written and human-directed atlas of geo-history, governed by the Magna Carta of the Seas.",
};

const S = {
  page: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "40px 22px 80px",
    lineHeight: 1.65,
  } as const,
  kicker: {
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    fontSize: 12,
    color: "var(--brass)",
  } as const,
  h2: { marginTop: 36, fontSize: "1.35rem" } as const,
  quote: {
    margin: "18px 0",
    paddingLeft: 14,
    borderLeft: "3px solid var(--brass)",
    fontStyle: "italic",
    color: "var(--ink-soft)",
  } as const,
};

export default function About() {
  return (
    <main style={S.page}>
      <span style={S.kicker}>Terraveler · About</span>
      <h1 style={{ margin: "6px 0 4px", fontSize: "2rem" }}>
        An atlas of geo-history, written in tandem
      </h1>
      <p style={S.quote}>
        Terraveler makes the geographic history of humankind explorable — across
        space and time — with the rigour of sources and the creative power of AI.
      </p>

      <p>
        Terraveler tells the great voyages as living charts: the route unfolds on
        the map as time advances, the navigator&rsquo;s own journal speaks at every
        landfall, the political world of the era colours the land, and a second
        timeline whispers what was happening <em>meanwhile, elsewhere in the
        world</em>. Every quotation is verbatim and cited; every claim carries its
        source and its degree of certainty. Where history is uncertain or
        contested, we say so — declaring doubt is part of being trustworthy.
      </p>

      <h2 style={S.h2}>The tandem: humans direct, AI writes</h2>
      <p>
        Terraveler is an open project, but not an anarchic one. Contributors do
        not write articles: they bring <strong>ideas</strong> — a voyage to add, a
        perspective to explore, a gap to fill. Their <strong>AI</strong> (connected
        through Terraveler&rsquo;s MCP interface) researches the sources and drafts
        the content. A <strong>Curator AI</strong> then verifies every submission —
        claim by claim, source by source — before anything is published, and a
        human editor-in-chief holds final authority. Nothing enters the site
        without passing this process. Nothing.
      </p>

      <h2 style={S.h2}>The Magna Carta of the Seas</h2>
      <p>
        The whole process is governed by our editorial constitution, the{" "}
        <a
          href="https://github.com/vitruvyan/terraveler/blob/main/MAGNA_CARTA.md"
          target="_blank"
          rel="noreferrer"
        >
          Magna Carta of the Seas
        </a>
        : the standard of evidence (no source, no entry), the voice (sober,
        vivid, multi-perspective), the ranks contributors earn through verified
        work, and the open licence (CC&nbsp;BY-SA) under which all approved
        content is published. Like the ship&rsquo;s articles of the age of sail, you
        sign it before you sail.
      </p>

      <h2 style={S.h2}>What you can do today</h2>
      <p>
        Follow Bougainville&rsquo;s circumnavigation (1766–1769) — scrub the
        timeline, read the journals, switch lenses (Log, Chart, Cartographer),
        hover the empires of 1715 — and ask <strong>Antonio Pigafetta</strong>,
        our chronicler, anything about the voyage: he answers only from the
        sources, and cites them.
      </p>

      <h2 style={S.h2}>Where this is going</h2>
      <p>
        More voyages, more lenses (Art, Peoples), voyages beyond Earth — the
        probes that crossed the Solar System kept logs too — and the opening of
        contributions under the Carta. Terraveler is built in the open:{" "}
        <a
          href="https://github.com/vitruvyan/terraveler"
          target="_blank"
          rel="noreferrer"
        >
          github.com/vitruvyan/terraveler
        </a>
        .
      </p>

      <p style={{ marginTop: 40 }}>
        <Link href="/contribute">See what the atlas is looking for →</Link> ·{" "}
        <Link href="/">← Return to the voyage</Link>
      </p>
      <SiteFooter />
    </main>
  );
}
