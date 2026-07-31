import type { Metadata } from "next";
import "../specimen.css";
import Chapters from "../Chapters";
import BackToTop from "../BackToTop";
import Ornament from "@/components/Ornament";
import Icon from "@/components/Icon";

export const metadata: Metadata = { title: "Plate specimen" };

/* Capitolo IV — le tavole.
   Immagini vere prese da public/login-backgrounds/, con i crediti e gli URL di
   Commons che stanno in CREDITS.md accanto a loro. La forma dei campi è quella
   di MediaItem in lib/types.ts: url, caption, credit, source_url, license,
   date, e rights_note quando l'istituzione pone termini propri sulla scansione. */

type Plate = {
  url: string;
  caption: string;
  credit: string;
  source_url: string;
  license: string;
  date: string;
};

const PLATES: Plate[] = [
  {
    url: "/login-backgrounds/ortelius-world-map-1570.jpg",
    caption: "Typus Orbis Terrarum — the world as Ortelius engraved it, three generations after Columbus and with the Pacific still guessed at.",
    credit: "Abraham Ortelius",
    date: "1570",
    source_url: "https://commons.wikimedia.org/wiki/File:OrteliusWorldMap1570.jpg",
    license: "public domain",
  },
  {
    url: "/login-backgrounds/carta-marina.png",
    caption: "Carta Marina — the northern seas, with the monsters drawn where the soundings stopped.",
    credit: "Olaus Magnus",
    date: "1539",
    source_url: "https://commons.wikimedia.org/wiki/File:CartaMarina.png",
    license: "public domain",
  },
  {
    url: "/login-backgrounds/fra-mauro-map.jpg",
    caption: "The Fra Mauro world map, drawn south-up, as the Arab cartographers it borrowed from drew theirs.",
    credit: "Fra Mauro",
    date: "c. 1450",
    source_url: "https://commons.wikimedia.org/wiki/File:FraMauroDetailedMap.jpg",
    license: "public domain",
  },
];

function PlateFigure({ p, size = "wide" }: { p: Plate; size?: "wide" | "inset" }) {
  return (
    <figure className={`spec-plate is-${size}`}>
      <div className="spec-plate-mount">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt={p.caption} loading="lazy" />
      </div>
      <figcaption>
        <p className="spec-plate-cap">{p.caption}</p>
        <div className="spec-plate-prov spec-machine">
          <span>{p.date}</span>
          <span className="spec-plate-sep">&middot;</span>
          <span>{p.credit}</span>
          <span className="spec-plate-sep">&middot;</span>
          <span>{p.license}</span>
          <span className="spec-plate-sep">&middot;</span>
          <a href={p.source_url} rel="noreferrer">
            commons
          </a>
        </div>
      </figcaption>
    </figure>
  );
}

export default function PlatesPage() {
  return (
    <div className="spec">
      <div className="spec-sheet">
        <header className="spec-masthead">
          <span className="spec-eyebrow">
            Terraveler &middot; saggio delle tavole &middot; capitolo iv
          </span>
          <h1>
            The <em>plates</em>
          </h1>
          <p className="spec-lede">
            {
              "An image in this atlas is not an illustration. It is a document with the same obligations as a quotation: it says what it is, who made it, and where it can be checked — or it does not appear."
            }
          </p>
        </header>

        <Chapters current="/specimen/plates" />

        <div className="spec-note">
          <b>Perché questo capitolo esiste.</b> Fissava{" "}
          <b>come si presenta una tavola</b> quando ancora non ce n&rsquo;erano:
          zero tappe su 380 con un&rsquo;immagine, la lente che diceva{" "}
          <i>no plates recorded</i>, e l&rsquo;API pubblica che non le esponeva
          affatto. Da allora il contratto è diventato eseguibile —{" "}
          <code>submit_draft</code> porta <code>plates[]</code>, il gate Stage-0
          rifiuta chi non li ha tutti, <code>get_voyage</code> li restituisce —
          e il capitolo ha smesso di essere una promessa per diventare la
          specifica che quel gate applica. Il campo <code>date</code> è nato
          qui, dopo: nessuno lo aveva chiesto ed è quello che ha intercettato
          più errori.
        </div>

        <Ornament name="break" className="ornament-break" />

        {/* ============ i · il contratto ============ */}
        <section>
          <span className="spec-eyebrow">i &middot; il contratto</span>
          <p className="spec-prose dropcap" style={{ maxWidth: "var(--measure)" }}>
            {
              "Every plate carries six fields, and five of them are provenance: the image itself, a caption saying what is being looked at, the credit naming who made it, the licence under which it may be shown, a source that can be opened and checked, and the date the image was MADE. That ratio is the point — a picture is the easiest thing on a page to lift and the hardest to attribute, which is exactly why the atlas refuses to publish one that cannot account for itself. The date was the field nobody thought to ask for, and it is the one that has caught the most: an image set beside a dated stage asserts they share that date, silently, and most plates are later than the moment they illustrate."
            }
          </p>

          <div className="spec-contract">
            {[
              ["url", "The image. Wikimedia Commons or another openly licensed archive — never a hotlink to a site that has not licensed it.", "machine"],
              ["caption", "What is being looked at, in the atlas's own voice. Not a title: a sentence.", "narrator"],
              ["credit", "Who made it. Not when — that is its own field, because the two answers come apart.", "machine"],
              ["license", "Under what terms it may be shown. A plate with no licence does not publish.", "machine"],
              ["source_url", "Where to check it. The description page, not the file.", "machine"],
              ["date", "When the IMAGE was made — not when the stage happened. Hodges drew Cape Town in 1787 and the Boudeuse moored there in 1769; without this the page quietly claims otherwise. Required.", "machine"],
              ["rights_note", "Optional. The holder's own terms, where they differ from the work's licence: a 1772 engraving is public domain and the library still asserts something about its scan of it.", "narrator"],
            ].map(([f, why, voice]) => (
              <div className="spec-contract-row" key={f}>
                <span className="spec-machine spec-contract-field">{f}</span>
                <span className="spec-contract-why">{why}</span>
                <span className={`spec-contract-voice is-${voice}`}>{voice}</span>
              </div>
            ))}
          </div>

          <div className="spec-note">
            <b>Una sola riga in voce di narratore.</b> La didascalia è l&rsquo;atlante
            che parla e va in serif; data, credito, licenza e fonte sono la
            macchina che registra, quindi monospazio. È la stessa regola del
            registro di bordo, applicata a un&rsquo;immagine. E la data sta
            prima del credito perché è la riga che può contraddire la pagina:
            il credito dice <i>chi</i>, mai <i>quando</i> — se un credito porta
            l&rsquo;anno, la riga lo stampa due volte e si vede subito.
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ ii · la montatura ============ */}
        <section>
          <span className="spec-eyebrow">ii &middot; la montatura</span>
          <p className="spec-prose dropcap" style={{ maxWidth: "var(--measure)" }}>
            {
              "An engraving pasted flat onto parchment looks like a mistake. What it wants is a mount: a margin of paper around it, a hairline where the sheet ends, and nothing else — no rounded corner, no shadow, no card. The plate is inset into the page rather than floating above it, which is also true of how the thing was originally bound."
            }
          </p>

          <PlateFigure p={PLATES[0]} />

          <div className="spec-note">
            <b>Angoli e ombre.</b> La legge dice che la carta non ha angoli
            stondati e non proietta ombre: una tavola sta <i>dentro</i> la
            pagina, non sopra. Il filetto e il margine bastano — sono gli stessi
            due strumenti con cui un incisore montava una stampa.
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ iii · dove sta ============ */}
        <section>
          <span className="spec-eyebrow">iii &middot; le tre posizioni</span>

          <div className="spec-plate-places">
            <div>
              <span className="spec-margin-note">a &middot; nella narrazione</span>
              <p className="spec-swatch-role">
                {
                  "Set into the stage it belongs to, at the measure of the text. The reader meets it where the traveller did."
                }
              </p>
              <PlateFigure p={PLATES[1]} size="inset" />
            </div>
            <div>
              <span className="spec-margin-note">b &middot; nella lente</span>
              <p className="spec-swatch-role">
                {
                  "The plates lens gathers every image of a voyage in stage order, grouped by place. A contact sheet, not a gallery."
                }
              </p>
              <div className="spec-contact">
                {PLATES.map((p) => (
                  <figure key={p.url}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.caption} loading="lazy" />
                    <figcaption className="spec-machine">{p.credit}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>

          <div className="spec-note">
            <b>c &middot; a piena pagina.</b> Il lightbox è l&rsquo;unico posto in cui
            una tavola può galleggiare sopra la pagina, perché lì lo fa davvero:
            è l&rsquo;unica eccezione consentita a <b>--elev-1</b>. Anche lì
            didascalia, credito, licenza e fonte restano attaccati
            all&rsquo;immagine — un&rsquo;immagine ingrandita non perde la sua
            provenienza.
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ iv · ciò che manca ============ */}
        <section>
          <span className="spec-eyebrow">iv &middot; ciò che manca</span>
          <div className="spec-lost" style={{ maxWidth: "var(--measure)" }}>
            <span className="spec-margin-note" style={{ color: "var(--accent)" }}>
              not yet built
            </span>
            <p>
              {
                "Nessuna tappa nei dati del repo porta un'immagine; le tavole vivono nel backend e l'API pubblica non le espone. Manca inoltre: un'inquadratura dichiarata (una carta e un ritratto non vogliono lo stesso ritaglio), un fallback per quando l'archivio non risponde, e la regola su cosa fare quando esiste un'immagine ma non la sua licenza — che secondo il contratto qui sopra significa non pubblicarla."
              }
            </p>
          </div>
        </section>

        <Ornament name="tail" className="ornament-tail" />
        <BackToTop />
      </div>
    </div>
  );
}
