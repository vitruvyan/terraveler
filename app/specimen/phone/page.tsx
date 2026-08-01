"use client";

import { useCallback, useRef, useState } from "react";
import "../specimen.css";
import Chapters from "../Chapters";
import BackToTop from "../BackToTop";
import Ornament from "@/components/Ornament";

/* ---------------------------------------------------------------------------
   Capitolo V — il telefono.

   Questa pagina non contiene nessuno screenshot e nessun numero scritto a
   mano. Monta il sito vero dentro un iframe e lo misura, come il capitolo dei
   colori legge i token invece di ricopiarli.

   Perché un iframe e non un div stretto: `data-layout` nasce da matchMedia
   contro il VIEWPORT (lib/layout.ts). Un div da 390px dentro uno schermo da
   1280 riceve `data-layout="wide"` — mostrerebbe l'albero desktop dentro una
   scatola stretta, e la bugia non si vedrebbe. Un iframe ha un viewport
   proprio, quindi l'attributo si mette a "phone" da solo, esattamente come
   sul telefono.
   ------------------------------------------------------------------------ */

const SUBJECT = "/voyage/boudeuse-1766";

/* Le bande di chrome, nella definizione con cui è stata presa la misura che
   ha guidato il lavoro sul telefono. Non è l'elenco di tutto ciò che
   galleggia sopra la mappa: è l'elenco di ciò che le TOGLIE ALTEZZA, perché
   la mappa su un telefono si perde per fasce orizzontali, non per angoli. */
const BANDS = [
  ".map-imprint",
  ".tr-cluster",
  ".world-strip",
  ".hist-note",
  ".transport-bar",
  ".pig-launch",
  ".maplibregl-ctrl-bottom-right",
  ".lens-rail",
] as const;

/* Il tetto. Non è un numero scelto: è l'ultima misura buona, quella con cui
   il commit c5ff173 ha chiuso. Serve a impedire un regresso, non a promettere
   un ideale — se scende, si abbassa anche questo. */
const CEILING = 26;

type Band = { sel: string; y: number; h: number; w: number; pct: number; full: boolean };
type Reading = { h: number; w: number; bands: Band[]; eaten: number };

/* La misura, identica a quella presa fuori dal browser: unione delle righe di
   viewport coperte da una banda, e conta solo chi attraversa più della metà
   dello schermo. Una banda stretta sta ACCANTO alla mappa; una banda larga
   gliela porta via. Due bande sovrapposte rubano l'altezza una volta sola —
   ed è per questo che è un'unione e non una somma. */
function measure(win: Window): Reading | null {
  const doc = win.document;
  const H = win.innerHeight;
  const W = win.innerWidth;
  if (!H || !W) return null;

  const covered = new Uint8Array(H);
  const bands: Band[] = [];

  for (const sel of BANDS) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const full = r.width > W * 0.55;
    bands.push({
      sel,
      y: Math.round(r.y),
      h: Math.round(r.height),
      w: Math.round(r.width),
      pct: +((r.height / H) * 100).toFixed(1),
      full,
    });
    if (full) {
      for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(H, Math.ceil(r.y + r.height)); y++) {
        covered[y] = 1;
      }
    }
  }

  let c = 0;
  for (let i = 0; i < H; i++) c += covered[i];
  return { h: H, w: W, bands, eaten: +((c / H) * 100).toFixed(1) };
}

/* Un viewport vero, a misura dichiarata, ridotto solo otticamente: `scale`
   cambia quanto è grande sulla scrivania, non quanto è grande per il CSS che
   ci gira dentro. Nasce al click perché ogni cornice è un'istanza MapLibre
   intera, e tre insieme si sentono. */
function Viewport({
  w,
  h,
  scale = 1,
  label,
  note,
  onReading,
}: {
  w: number;
  h: number;
  scale?: number;
  label: string;
  note: string;
  onReading?: (r: Reading | null) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<string>("—");

  const read = useCallback(() => {
    const win = ref.current?.contentWindow;
    if (!win) return;
    try {
      setMode(win.document.documentElement.getAttribute("data-layout") ?? "—");
      onReading?.(measure(win));
    } catch {
      /* Stessa origine, quindi non dovrebbe accadere. Se accade, la pagina lo
         dice invece di mostrare un numero inventato. */
      setMode("non leggibile");
      onReading?.(null);
    }
  }, [onReading]);

  /* `load` scatta prima che la mappa sia ferma: le tile e la rotta arrivano
     dopo, e le bande in basso si impilano su misura una volta arrivate. Due
     letture, e poi il pulsante per chi vuole insistere. */
  function onLoad() {
    window.setTimeout(read, 1200);
    window.setTimeout(read, 3500);
  }

  return (
    <figure className="spec-vp-fig" style={{ width: w * scale }}>
      <figcaption>
        <span className="spec-margin-note">{label}</span>
        <span className="spec-machine spec-vp-dim">
          {w}&thinsp;&times;&thinsp;{h}
          {on && (
            <>
              {" · data-layout="}
              <b>{mode}</b>
            </>
          )}
        </span>
      </figcaption>

      <div className="spec-vp" style={{ width: w * scale, height: h * scale }}>
        {on ? (
          <iframe
            ref={ref}
            src={SUBJECT}
            title={`${label} — ${w}×${h}`}
            onLoad={onLoad}
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          />
        ) : (
          <button className="spec-vp-load" onClick={() => setOn(true)}>
            carica
          </button>
        )}
      </div>

      <p className="spec-vp-note">{note}</p>
      {on && onReading && (
        <button className="spec-vp-again spec-machine" onClick={read}>
          misura di nuovo
        </button>
      )}
    </figure>
  );
}

/* Ciò che i due alberi non hanno in comune. Scritto a mano perché è la cosa
   che il codice non sa dire di sé: `[data-layout="phone"]` in globals.css dice
   COSA cambia, `useLayoutMode()` dice DOVE l'albero si biforca, e nessuno dei
   due dice se quella biforcazione era una decisione o un rattoppo. */
type Split = { what: string; where: string; how: "albero" | "stile" };

const ONLY_PHONE: Split[] = [
  {
    what: "Un pannello è una pagina: a pieno schermo, opaco, con scroll proprio e overscroll-behavior: contain. Mentre leggi il registro non stai guardando la mappa, e fingere il contrario è ciò che è costato la leggibilità al testo.",
    where: "DraggableWindow.tsx · .win",
    how: "albero",
  },
  {
    what: "Il posizionamento inline è TRATTENUTO, non sovrascritto. La vecchia regola aveva bisogno di sei !important per combattere il componente che glieli causava.",
    where: "DraggableWindow.tsx",
    how: "albero",
  },
  {
    what: "La nota di base è un chip da toccare: una riga sola, il resto a un tap. Non si perde nulla, smette di essere gridata.",
    where: "MapNote.tsx · .map-note-chip",
    how: "albero",
  },
  {
    what: "La rail delle lenti collassa in un bottone che mostra la lente attiva, e si richiude con una ×.",
    where: "VoyageExperience.tsx · SpaceVoyageExperience.tsx",
    how: "albero",
  },
  {
    what: "La pill di Pigafetta è tonda, 48px, e perde la parola: le porte tonde accanto sono 40 e sono già sotto il minimo del dito.",
    where: ".pig-pill · .pig-pill-word",
    how: "stile",
  },
  {
    what: "Il play della barra di trasporto torna a 44px, e la riga in alto stringe i margini.",
    where: ".transport-bar .play-btn · .map-top",
    how: "stile",
  },
];

const ONLY_WIDE: Split[] = [
  {
    what: "La finestra si trascina. Sul telefono non c'è dove trascinarla, quindi la maniglia — che era disegnata e non funzionava — non viene disegnata.",
    where: ".win-bar · pointer capture",
    how: "albero",
  },
  {
    what: "La finestra si minimizza. Una pagina si chiude e basta: non c'è nulla in cui minimizzarla.",
    where: ".win-btn.win-min",
    how: "stile",
  },
  {
    what: "La nota di base sta per esteso nel margine — che è dove una nota a margine ha senso, perché un margine esiste.",
    where: ".hist-note",
    how: "albero",
  },
  {
    what: "La rail mostra tutte le lenti insieme, e la pill porta la sua parola.",
    where: ".lens-rail · .pig-pill",
    how: "albero",
  },
];

export default function PhonePage() {
  const [reading, setReading] = useState<Reading | null>(null);

  return (
    <div className="spec">
      <div className="spec-sheet">
        <header className="spec-masthead">
          <span className="spec-eyebrow">
            Terraveler &middot; saggio della mappa &middot; capitolo v
          </span>
          <h1>
            The <em>phone</em>
          </h1>
          <p className="spec-lede">
            {
              "The map is the only surface on this site that is judged by a quantity. Everywhere else the question is whether a thing reads; here it is how much of the screen is left for the subject after the instruments have taken theirs. A number that lives in a screenshot is a number nobody checks — so it lives on this page, taken from the running site, every time the page is opened."
            }
          </p>
        </header>

        <Chapters current="/specimen/phone" />

        <div className="spec-note">
          <b>Perché questo capitolo esiste.</b> La mappa è l&rsquo;unica
          superficie <i>maneggiata</i> invece che letta, e le sue regole — la
          portata del pollice, cosa diventa un pannello quando non c&rsquo;è
          spazio, quanto schermo può prendersi la chrome — non valgono per
          nessuna delle altre diciotto route. Finora quelle regole sono state
          verificate su screenshot e su una misura presa fuori dal browser, su
          una macchina sola. Qui la misura è nella pagina: se qualcuno cambia
          una banda, questo capitolo lo dice al primo caricamento invece di
          restare una promessa.
        </div>

        <Ornament name="break" className="ornament-break" />

        {/* ============ i · i due alberi ============ */}
        <section>
          <span className="spec-eyebrow">i &middot; i due alberi</span>
          <p className="spec-prose dropcap" style={{ maxWidth: "var(--measure)" }}>
            {
              "The same voyage, at two sizes, both live. Not two renderings of a picture: two viewports, each running the site and each deciding for itself which arrangement it is in. What the narrow one shows is not the wide one made smaller — a panel has become a page, a note has become a chip, a rail has become a button. Put side by side, that divergence stops being something discovered on a phone and becomes something decided on a desk."
            }
          </p>

          <div className="spec-vp-row">
            <Viewport
              w={390}
              h={844}
              label="telefono &middot; il riferimento"
              note="390×844 è la misura su cui è stata presa ogni decisione di questa sessione. Nessun tocco vero: un iframe su una scrivania non ha dita, quindi :hover qui si comporta come sul desktop e sul telefono no."
              onReading={setReading}
            />
            <Viewport
              w={1280}
              h={800}
              scale={0.5}
              label="largo &middot; l'albero d'origine"
              note="Ridotto a metà solo otticamente: dentro, il CSS continua a vedere 1280 e riceve data-layout=wide. La scala cambia quanto è grande sul tuo schermo, non quanto è grande per la pagina."
            />
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ ii · il budget di chrome ============ */}
        <section>
          <span className="spec-eyebrow">ii &middot; il budget di chrome</span>
          <p className="spec-prose" style={{ maxWidth: "var(--measure)" }}>
            {
              "A map is not lost at its corners, it is lost in horizontal bands: an instrument that spans the screen takes the whole width of everything behind it, and an instrument that does not sits beside the map rather than on it. So the measure counts only the bands that cross more than half the screen, and it counts the rows of the viewport they cover — as a union, because two overlapping bands take the height once."
            }
          </p>

          {reading ? (
            <>
              <div className="spec-budget">
                <span className="spec-budget-n">{reading.eaten}%</span>
                <span className="spec-budget-of">
                  dello schermo preso dalle bande a piena larghezza
                  <br />
                  <span className="spec-machine">
                    viewport {reading.w}&thinsp;&times;&thinsp;{reading.h} &middot; tetto{" "}
                    {CEILING}%
                  </span>
                </span>
                <span
                  className={`spec-budget-mark ${
                    reading.eaten <= CEILING ? "is-ok" : "is-no"
                  }`}
                >
                  {reading.eaten <= CEILING ? "entro il tetto" : "regresso"}
                </span>
              </div>

              <div className="spec-bands">
                {reading.bands.map((b) => (
                  <div className={`spec-band ${b.full ? "is-full" : ""}`} key={b.sel}>
                    <span className="spec-machine spec-band-sel">{b.sel}</span>
                    <span className="spec-band-bar">
                      <span style={{ width: `${Math.min(100, b.pct * 4)}%` }} />
                    </span>
                    <span className="spec-machine spec-band-n">{b.pct}%</span>
                    <span className="spec-machine spec-band-w">
                      {b.h}px &times; {b.w}
                    </span>
                    <span className="spec-band-kind">
                      {b.full ? "toglie altezza" : "sta accanto"}
                    </span>
                  </div>
                ))}
              </div>

              <div className="spec-note">
                <b>La riga che vale più di tutte è .hist-note.</b> È lo stesso
                selettore nei due alberi — sul telefono porta anche{" "}
                <code>.map-note-chip</code> — e passa da sei righe di mono a una
                riga da toccare. Si mangiava il 12,9% dello schermo, più di
                qualunque altra banda, e nessuno se n&rsquo;era accorto perché{" "}
                <i>sembrava una didascalia</i>. Una banda si nota quando dà
                fastidio; questa dava fastidio alla mappa, che non protesta.
              </div>
            </>
          ) : (
            <p className="spec-vp-empty spec-machine">
              carica la cornice del telefono qui sopra — la misura si prende da
              lì
            </p>
          )}

          <div className="spec-note">
            <b>Cosa questo numero non è.</b> Non è quello che vedi tu. Un
            iframe su un browser da scrivania non ha tocco, non ha la barra
            dell&rsquo;indirizzo che si ritira allo scroll, e non emula la
            densità di pixel — quindi <code>100dvh</code> qui è stabile e sul
            telefono no. È una misura ripetibile del rapporto fra strumenti e
            soggetto, non una simulazione del tuo apparecchio. Per quello serve
            il capitolo seguente, e nemmeno lui basta.
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ iii · il tuo telefono ============ */}
        <section>
          <span className="spec-eyebrow">iii &middot; il tuo telefono</span>
          <p className="spec-prose" style={{ maxWidth: "var(--measure)" }}>
            {
              "The screenshots that started this work came from a 1080×2316 device, which at its pixel ratio is a viewport of 360×772 — narrower and shorter than the reference everything was decided on. That gap is not academic: one fault reported from those screenshots, the map going blank behind an open panel, has never reproduced at 390×844. Here is the same site at the size it was seen at."
            }
          </p>

          <div className="spec-vp-row">
            <Viewport
              w={360}
              h={772}
              label="il dispositivo degli screenshot"
              note="1080×2316 a densità 3 = 360×772 di viewport. Trenta pixel più stretto e settantadue più basso del riferimento: abbastanza perché una banda che entrava non entri più."
            />
          </div>

          <div className="spec-lost" style={{ maxWidth: "var(--measure)" }}>
            <span className="spec-margin-note" style={{ color: "var(--accent)" }}>
              non riprodotto
            </span>
            <p>
              {
                "La mappa che resta bianca dietro un pannello aperto non si riproduce qui, e non si riproduceva a 390×844. Finché non lo fa, questa pagina non è la prova che il difetto non esista: è la prova che non dipende soltanto dalla misura dello schermo. I candidati che restano sono il tocco, la barra dell'indirizzo che cambia l'altezza sotto la mappa, la memoria del dispositivo, e il contesto WebGL che Chrome su Android butta via quando qualcosa gli sta sopra a pieno schermo — che è esattamente ciò che un pannello è diventato."
              }
            </p>
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ iv · l'inventario ============ */}
        <section>
          <span className="spec-eyebrow">iv &middot; l&rsquo;inventario</span>
          <p className="spec-prose" style={{ maxWidth: "var(--measure)" }}>
            {
              "Everything the two arrangements do not share, and where each divergence is written. The last column is the one that matters: a divergence carried by the stylesheet is the same thing arranged differently, and a divergence carried by the tree is a different thing. The first kind belongs in CSS and costs nothing. The second kind is a component pretending to be one component, and it is what a separate map tree would make honest."
            }
          </p>

          <span className="spec-margin-note spec-inv-head">
            solo sul telefono
          </span>
          <div className="spec-contract">
            {ONLY_PHONE.map((s) => (
              <div className="spec-contract-row spec-inv-row" key={s.where}>
                <span className="spec-machine spec-contract-field">{s.where}</span>
                <span className="spec-contract-why">{s.what}</span>
                <span className={`spec-contract-voice is-${s.how === "albero" ? "narrator" : "machine"}`}>
                  {s.how}
                </span>
              </div>
            ))}
          </div>

          <span className="spec-margin-note spec-inv-head">solo largo</span>
          <div className="spec-contract">
            {ONLY_WIDE.map((s) => (
              <div className="spec-contract-row spec-inv-row" key={s.where}>
                <span className="spec-machine spec-contract-field">{s.where}</span>
                <span className="spec-contract-why">{s.what}</span>
                <span className={`spec-contract-voice is-${s.how === "albero" ? "narrator" : "machine"}`}>
                  {s.how}
                </span>
              </div>
            ))}
          </div>

          <div className="spec-note">
            <b>Il conto che questa tavola serve a fare.</b> Sei divergenze su
            dieci sono già <i>albero</i>, e vivono dentro due componenti da 1138
            e 763 righe che si biforcano su <code>isMobile</code> in due punti
            ciascuno. Il resto della differenza lo porta il foglio di stile: 15
            regole <code>[data-layout=&quot;phone&quot;]</code> e 15{" "}
            <code>!important</code>. Un <code>!important</code> non è
            sciatteria — è una regola che combatte una struttura che non le
            assomiglia, ed è il modo in cui un albero solo dice che sono due.
          </div>
        </section>

        <Ornament name="break" className="ornament-break" />

        {/* ============ v · ciò che manca ============ */}
        <section>
          <span className="spec-eyebrow">v &middot; ciò che manca</span>
          <div className="spec-lost" style={{ maxWidth: "var(--measure)" }}>
            <span className="spec-margin-note" style={{ color: "var(--accent)" }}>
              not yet built
            </span>
            <p>
              {
                "Il portolano — la legge di questa superficie — non è ancora scritto, e questa pagina esiste perché venga scritto da ciò che mostra invece che da ciò che si crede. Mancano poi: le porte fuse in una sola, la porta Atlante che è quadrata dove le altre sono tonde, il logo che sul telefono non è ridotto, lo zoom sul lightbox, e le cornici negli stati aperti — pannello, rail, chat — che oggi si raggiungono solo toccando dentro l'iframe. Manca soprattutto il tocco: nessuna @media (hover: hover) esiste nel foglio, quindi ogni :hover scatta al tap e ci resta, e questa pagina non può mostrarlo perché una scrivania non ha dita."
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
