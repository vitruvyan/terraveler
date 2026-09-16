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
    note: "Use when geography itself is speaking — a horizon, a route, an instrument, a threshold.",
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
    note: "The mythical register is a historical voice: it belongs at the edge of knowledge, never as generic fantasy wallpaper.",
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
    note: "Context before spectacle. A Maya city, a colonial square and an Arcadian allegory are not interchangeable visual shorthand.",
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
    note: "Use the role to explain the story: command, labour, navigation and apprenticeship should remain visibly distinct.",
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
      <main className="spec-sheet illus-sheet">
        <Chapters current="/specimen/illustration" />

        <header className="illus-hero">
          <div className="illus-hero-copy">
            <span className="spec-eyebrow">VI · the illustrated atlas</span>
            <h1>Illustration<br /><em>Specimen</em></h1>
            <p className="spec-lede">
              Engravings, allegories and cartographic marks for a world that should feel printed before it feels rendered.
            </p>
          </div>
          <div className="illus-hero-art" aria-hidden="true" />
        </header>

        <section className="illus-prologue" aria-label="Illustration principles">
          <div className="illus-prologue-copy">
            <p className="spec-prose has-dropcap">
              The illustration library is a growing collection of original engravings made for Terraveler. The rule is the same as the type specimen: ornament must carry meaning. An image may establish place, period, uncertainty or voice; it may not merely fill an empty corner.
            </p>
            <p className="spec-prose">
              Phase one fixes the terrestrial register. The image is treated like a plate from an atlas: given room, accompanied by provenance, and never forced into the geometry of a software card.
            </p>
          </div>
          <aside className="illus-prologue-margin">
            <span className="spec-margin-note">phase one</span>
            <strong>4 families</strong>
            <span className="spec-machine">30 plates · v1</span>
          </aside>
        </section>

        <Ornament name="break" className="ornament-break illus-break" />

        <div className="illus-thesis">
          <span className="spec-eyebrow">The governing rule</span>
          <blockquote>“The engraving is a voice, not wallpaper.”</blockquote>
          <p>Its scale, placement and density should tell the reader why it is present before the caption has to explain it.</p>
        </div>

        <section aria-label="Illustration families" className="illus-catalogue">
          {FAMILIES.map((family, index) => (
            <article className={`illus-family${index % 2 ? " is-reverse" : ""}`} key={family.n}>
              <div className="illus-family-number" aria-hidden="true">{family.n}</div>

              <header className="illus-family-heading">
                <span className="spec-eyebrow">Plate family {family.n}</span>
                <h2>{family.title}</h2>
                <p className="illus-family-kicker">{family.kicker}</p>
              </header>

              <figure className="illus-plate">
                <div className={`illus-preview ${family.preview}`} role="img" aria-label={`${family.title} engraved plate preview`} />
                <figcaption>
                  <span>{family.plates}</span>
                  <span>use · {family.use}</span>
                  <strong>active</strong>
                </figcaption>
              </figure>

              <div className="illus-family-text">
                <p className="illus-family-copy">{family.copy}</p>
                <div className="illus-use-note">
                  <span className="spec-margin-note">editorial use</span>
                  <p>{family.note}</p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="illus-next" aria-labelledby="coming-next">
          <div className="illus-next-head">
            <div>
              <span className="spec-eyebrow">Coming next</span>
              <h2 id="coming-next">Further realms,<br /><em>further wonders.</em></h2>
            </div>
            <p>
              Phase two leaves the terrestrial register behind without abandoning the house style: observation, instrument, terrain and wonder — translated into a colder visual language.
            </p>
          </div>
          <div className="illus-next-grid">
            {NEXT.map((item, index) => (
              <article className="illus-next-card" key={item.title}>
                <span className="spec-machine">0{index + 5}</span>
                <h3>{item.title}</h3>
                <div className={item.className} aria-hidden="true" />
                <p>{item.copy}</p>
                <span className="spec-margin-note">in development</span>
              </article>
            ))}
          </div>
        </section>

        <BackToTop />
      </main>
    </div>
  );
}
