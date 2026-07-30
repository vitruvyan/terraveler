import type { Metadata } from "next";
import localFont from "next/font/local";
import "../specimen.css";
import Chapters from "../Chapters";
import BackToTop from "../BackToTop";
import Ornament from "@/components/Ornament";
import Icon, { type IconName } from "@/components/Icon";

/* Capitolo III — il marchio e le icone.
   Le candidate calligrafiche sono rese qui col carattere vero, ai corpi veri
   della testata, perché una decisione di identità si prende guardandola alla
   dimensione in cui vivrà e non ingrandita. */

const pinyon = localFont({
  src: [{ path: "../../fonts/pinyon.woff2", weight: "400", style: "normal" }],
  variable: "--font-pinyon",
  display: "swap",
});
const petit = localFont({
  src: [{ path: "../../fonts/petit.woff2", weight: "400", style: "normal" }],
  variable: "--font-petit",
  display: "swap",
});

export const metadata: Metadata = { title: "Mark specimen" };

const TAGLINE = "An atlas of geo-history, written in tandem";

const ICONS: { name: IconName; was: string; role: string }[] = [
  { name: "globe", was: "🌐", role: "The atlas itself — the emblem on the map" },
  { name: "anchor", was: "⚓", role: "The voyage lens" },
  { name: "map", was: "🗺", role: "Historical borders" },
  { name: "compass", was: "🧭", role: "The cartographer's lens" },
  { name: "plates", was: "🖼", role: "Engraved plates" },
  { name: "antiquity", was: "🗿", role: "Antiquities" },
  { name: "scroll", was: "📜", role: "Read the log as text" },
  { name: "quill", was: "✒", role: "Contribute" },
  { name: "morion", was: "👤", role: "The reader — a conquistador's morion" },
  { name: "menu", was: "☰", role: "The menu" },
  { name: "pin", was: "📍", role: "A place" },
  { name: "hourglass", was: "🕰", role: "An era" },
  { name: "check", was: "✓", role: "Confirmed" },
  { name: "close", was: "×", role: "Dismiss" },
  { name: "play", was: "▶", role: "Sail" },
  { name: "pause", was: "❚❚", role: "Heave to" },
];

function Candidate({
  n,
  label,
  note,
  style,
  tagStyle,
}: {
  n: string;
  label: string;
  note: string;
  style: React.CSSProperties;
  tagStyle?: React.CSSProperties;
}) {
  return (
    <div className="spec-mark-row">
      <div className="spec-mark-label">
        <span className="spec-margin-note">{n}</span>
        <span className="spec-machine">{label}</span>
      </div>
      <div>
        {/* alla dimensione vera della testata */}
        <div className="spec-mark-real">
          <div style={style}>Terraveler</div>
          <div style={{ ...tagStyle }} className="spec-mark-tag">
            {TAGLINE}
          </div>
        </div>
        {/* e in grande, per vedere il disegno delle lettere */}
        <div style={{ ...style, fontSize: "3.4rem", marginTop: "var(--space-4)" }}>Terraveler</div>
        <p className="spec-voice-role">{note}</p>
      </div>
    </div>
  );
}

export default function MarkPage() {
  return (
    <div className={`spec ${pinyon.variable} ${petit.variable}`}>
      <div className="spec-sheet">
        <header className="spec-masthead">
          <span className="spec-eyebrow">
            Terraveler &middot; saggio del marchio &middot; capitolo iii
          </span>
          <h1>
            The mark of the <em>atlas</em>
          </h1>
          <p className="spec-lede">
            {
              "A wordmark is read at twenty-seven pixels, not at two hundred. Every candidate below is shown first at the size it actually lives at, and only then large enough to judge the letterforms."
            }
          </p>
        </header>

        <Chapters current="/specimen/mark" />

        <div className="spec-note">
          <b>Il problema di oggi.</b> Il wordmark è Cormorant a <b>peso 700</b>,{" "}
          <b>27px</b>, spaziatura <b>+0.06em</b>. Tre scelte giuste per EB
          Garamond 700, che era il carattere di prima, e tutte e tre sbagliate
          per questa faccia: Cormorant vive nei pesi leggeri, e a 700 gli aste
          si ingrossano fino a perdere il contrasto che è la sua ragione
          d&rsquo;essere.
        </div>

        <Ornament name="break" className="ornament-break" />

        <section>
          <span className="spec-eyebrow">i &middot; le candidate</span>

          <Candidate
            n="a"
            label="oggi"
            note="Cormorant 700, +0.06em. Il peso e la spaziatura positiva insieme producono il logotipo anni 90."
            style={{ fontFamily: "var(--font-cartouche), serif", fontWeight: 700, fontSize: "1.7rem", letterSpacing: "0.06em" }}
          />

          <Candidate
            n="b"
            label="Pinyon Script"
            note="Copperplate inciso — è letteralmente il lettering dei cartigli sulle carte del Settecento, quindi non è un vezzo ma la scelta storicamente esatta. Il rischio è tutto nella leggibilità ai corpi piccoli: guardalo nella riga in alto, non in quella grande."
            style={{ fontFamily: "var(--font-pinyon), cursive", fontSize: "2.5rem", lineHeight: 1, letterSpacing: "0" }}
          />

          <Candidate
            n="c"
            label="Petit Formal Script"
            note="Stessa famiglia di idee, tratto più largo e meno inclinato: tiene meglio in piccolo di Pinyon, ma è meno inciso e più moderno."
            style={{ fontFamily: "var(--font-petit), cursive", fontSize: "2.1rem", lineHeight: 1.1 }}
          />

          <Candidate
            n="d"
            label="Cormorant maiuscoletto"
            note="Non calligrafico: l'imprint inciso sul frontespizio. Qui la spaziatura larga è finalmente corretta — nel maiuscoletto è obbligatoria — e il marchio si distingue dai titoli di pagina pur restando la stessa famiglia."
            style={{ fontFamily: "var(--font-cartouche), serif", fontWeight: 500, fontSize: "1.55rem", fontVariantCaps: "all-small-caps", letterSpacing: "0.2em" }}
          />

          <Candidate
            n="e"
            label="Cormorant corsivo"
            note="Bello, ma il corsivo in questo sistema è già assegnato: è la voce del viaggiatore, quella delle citazioni verbatim. Usarlo per il marchio gli toglie il significato che ha."
            style={{ fontFamily: "var(--font-cartouche), serif", fontWeight: 300, fontStyle: "italic", fontSize: "2.2rem", letterSpacing: "-0.01em" }}
          />
        </section>

        <Ornament name="break" className="ornament-break" />

        <section>
          <span className="spec-eyebrow">ii &middot; le icone</span>
          <p className="spec-lede" style={{ fontSize: "var(--step-1)", marginBottom: "var(--space-6)" }}>
            {
              "Ventiquattro emoji facevano da sistema di icone. Il problema non è il gusto: un'emoji la disegna Apple o Google o Microsoft a seconda di chi guarda, quindi l'insegna dell'atlante non era nostra e non era mai la stessa due volte — e arrivano piene di colore da cartone su una pagina il cui intero argomento è inchiostro su pergamena."
            }
          </p>

          <div className="spec-icons">
            {ICONS.map((i) => (
              <div className="spec-icon-cell" key={i.name}>
                <div className="spec-icon-pair">
                  <span className="spec-icon-was">{i.was}</span>
                  <span className="spec-icon-arrow">&rarr;</span>
                  <Icon name={i.name} size={26} />
                </div>
                <span className="spec-machine spec-icon-name">{i.name}</span>
                <span className="spec-icon-role">{i.role}</span>
              </div>
            ))}
          </div>

          <div className="spec-note">
            <b>Provale a 18px, non a 48.</b> È la dimensione in cui vivono nella
            barra e nella rail, ed è lì che un disegno troppo fitto collassa.
          </div>

          <div className="spec-icons-small">
            {ICONS.map((i) => (
              <span key={i.name} className="spec-icon-small">
                <Icon name={i.name} size={18} />
              </span>
            ))}
          </div>
        </section>
        <BackToTop />
      </div>
    </div>
  );
}
