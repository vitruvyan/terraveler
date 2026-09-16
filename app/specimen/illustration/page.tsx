import type { Metadata } from "next";
import "../specimen.css";
import "./illustration.css";
import Chapters from "../Chapters";
import BackToTop from "../BackToTop";
import Ornament from "@/components/Ornament";

export const metadata: Metadata = {
  title: "Illustration specimen · Terraveler",
  robots: { index: false, follow: false },
};

const FAMILIES = [
  {
    n: "01",
    title: "Atlas & Cartography",
    plates: "plates 01–06",
    kicker: "mountains · coasts · compass rose · astrolabe · allegory",
    preview: "atlas",
    copy:
      "Foundational views of the terrestrial world: orography, coasts and islands, the ship, the instrument and the allegorical figure. These are environmental marks before they are illustrations.",
    use: "margins / hero / chapter opener",
  },
  {
    n: "02",
    title: "Mythic Seas & Allegories",
    plates: "plates 07–12",
    kicker: "kraken · sea dragon · Neptune · winds · Urania · ruins",
    preview: "mythic",
    copy:
      "Creatures, deities and symbolic figures from the unknown sea. Their job is not fantasy decoration: they mark uncertainty, passage, danger, knowledge and the edge of the chart.",
    use: "backgrounds / dividers / thematic pages",
  },
  {
    n: "03",
    title: "New Worlds & American Imaginaries",
    plates: "plates 13–24",
    kicker: "sirens · cyclops · Arcadia · Maya · masks · colonial architecture",
    preview: "newworlds",
    copy:
      "Landscapes, peoples, myths and built worlds across the Americas. This family carries encounter and cultural context, and must always be used with historical specificity rather than as a generic exotic register.",
    use: "regional pages / cultural sections",
  },
  {
    n: "04",
    title: "Mariners, Captains & Roles",
    plates: "plates 25–30",
    kicker: "conquistador · sailor · cabin boy · captain · navigator · helmsman",
    preview: "mariners",
    copy:
      "The people behind the journeys. Portrait-like engravings for narrative passages, ranks, labour, command, apprenticeship and moments in which a voyage becomes a human decision.",
    use: "characters / narrative pages",
  },
] as const;

const NEXT = [
  {
    title: "Space",
    className: "illus-orbit",
    copy: "Celestial mechanics, orreries, observatories and the architecture of the heavens.",
  },
  {
    title: "The Moon",
    className: "illus-orbit illus-moon",
    copy: "Lunar landscapes, phases, craters and topographies for a colder register.",
  },
  {
    title: "Mars",
    className: "illus-orbit illus-mars",
    copy: "Martian reliefs, canyons, instruments and the visual language of distant fieldwork.",
  },
] as const;

export default function IllustrationSpecimenPage() {
  return (
    <div className="spec illus-spec">
      <main className="spec-sheet">
        <Chapters current="/specimen/illustration" />

        <header className="illus-hero">
          <div className="illus-hero-copy">
            <span className="spec-eyebrow">Specimen library · phase one</span>
            <h1>Illustration<br />Specimen</h1>
            <p>
              Background engravings and allegorical assets for the Terraveler atlas —
              a visual vocabulary for margins, chapter openings, fields and thresholds.
            </p>
          </div>
          <div className="illus-hero-art" aria-hidden="true" />
        </header>

        <div className="illus-intro">
          <p>
            The illustration library is a growing collection of original engravings made for
            Terraveler. The rule is the same as the type specimen: ornament must carry meaning.
            An image may establish place, period, uncertainty or voice; it may not merely fill
            an empty corner. Phase one fixes the terrestrial register. Space comes next.
          </p>
          <span className="spec-margin-note illus-phase">4 families · 30 plates · v1</span>
        </div>

        <Ornament name="break" className="ornament-break" />

        <section aria-label="Illustration families" className="illus-grid">
          {FAMILIES.map((family) => (
            <article className="illus-family" key={family.n}>
              <div className="illus-family-head">
                <span className="illus-family-num">{family.n}</span>
                <h2>{family.title}</h2>
                <span className="illus-plate-count">{family.plates}</span>
              </div>
              <p className="illus-family-kicker">{family.kicker}</p>
              <div className={`illus-preview ${family.preview}`} role="img" aria-label={`${family.title} engraved plate preview`} />
              <p className="illus-family-copy">{family.copy}</p>
              <div className="illus-meta">
                <span>{family.plates}</span>
                <span>use · {family.use}</span>
                <strong>status · active</strong>
              </div>
            </article>
          ))}
        </section>

        <section className="illus-next" aria-labelledby="coming-next">
          <div className="illus-next-head">
            <div>
              <span className="spec-eyebrow">Coming next</span>
              <h2 id="coming-next">Further realms, further wonders.</h2>
            </div>
            <span className="spec-margin-note">phase two · in development</span>
          </div>
          <div className="illus-next-grid">
            {NEXT.map((item) => (
              <article className="illus-next-card" key={item.title}>
                <div className="illus-family-head">
                  <h3>{item.title}</h3>
                  <span />
                  <span className="illus-plate-count">in development</span>
                </div>
                <div className={item.className} aria-hidden="true" />
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <BackToTop />
      </main>
    </div>
  );
}
