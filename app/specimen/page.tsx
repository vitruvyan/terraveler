import type { Metadata } from "next";
import localFont from "next/font/local";
import "./specimen.css";
import { DeskHeading, DeskStanding, ShipsLog, type LogEntry } from "@/components/desk/Quarterdeck";

/* Il registro B non è più una finta: sono i componenti veri del Quarterdeck,
   alimentati con le righe reali del 28-30 luglio 2026. Il desk sta dietro una
   sessione, quindi questo è l'unico modo di guardare una modifica prima di
   spedirla — e se qualcuno cambia quei componenti, questa pagina cambia con
   loro invece di restare una promessa. */
const DESK_FEED: LogEntry[] = [
  {
    submission_id: 27, actor: "peer-review", action: "review", verdict: "confirm",
    created_at: "2026-07-29T20:19:09",
    findings: [
      "seq1.claim1 (Portsmouth departure): supported",
      "seq2.claim1 (Pisania arrival, Dr. Laidley, Ainsley brothers): supported",
    ],
  },
  {
    submission_id: 27, actor: "curator-gate", action: "verdict", verdict: "pass·gate",
    created_at: "2026-07-29T20:13:36", findings: [],
  },
  {
    submission_id: null, actor: "mcp", action: "register", verdict: null,
    created_at: "2026-07-29T20:11:35",
    findings: ["contributor 'claude-desktop' claimed by an authorised connection (3)"],
  },
  {
    submission_id: null, actor: "human:dbaldoni", action: "authorize", verdict: "granted",
    created_at: "2026-07-29T19:43:35",
    findings: [
      "client tv_3211f62a20aed2369feab49ac8370b6e · connection 3",
      "scopes: contribute, review, appeal",
    ],
  },
  {
    submission_id: 26, actor: "curator-desk", action: "verdict", verdict: "changes",
    created_at: "2026-07-28T20:39:20",
    findings: [
      "Drafted under Carta v0.4, in force is v0.5 — and v0.5 changed what a quotation is: these were transcribed by the scribe rather than copied out of the source, so the draft must be regenerated rather than edited.",
      "wp10: verbatim quotation, marked reconstructed — one of the two is wrong",
    ],
  },
  ...[17, 18, 19, 20].map((id) => ({
    submission_id: id, actor: "editor-in-chief", action: "correction",
    verdict: "carta-version-misrecorded", created_at: "2026-07-28T19:59:23",
    findings: [
      "The verdict row records carta_version 0.2. That is not the constitution the verdict was given under: it is a stale constant that four editorial desk routes each declared separately and never updated. Fixed at source by moving the constant to lib/carta.ts.",
    ],
  })),
];

/* Tre famiglie, tutte OFL e self-hosted — la stessa legge che la Magna Carta
   impone alle fonti vale per i caratteri. Subsettate a latino: 240 KB in tutto,
   contro gli 1,2 MB che oggi il sito paga per il solo wordmark. */

const cartouche = localFont({
  src: [
    { path: "../fonts/cormorant-var.woff2", weight: "300 700", style: "normal" },
    { path: "../fonts/cormorant-italic-var.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-cartouche",
  display: "swap",
});

const text = localFont({
  src: [
    { path: "../fonts/ebgaramond-var.woff2", weight: "400 700", style: "normal" },
    { path: "../fonts/ebgaramond-italic-var.woff2", weight: "400 700", style: "italic" },
  ],
  variable: "--font-text",
  display: "swap",
});

const machine = localFont({
  src: [
    { path: "../fonts/plexmono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/plexmono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-machine",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Type specimen",
  robots: { index: false, follow: false },
};

/* ---------------------------------------------------------------------------
   Contenuto vero, non lorem. Xuanzang viene da data/xuanzang-629.json,
   il registro di bordo dal Quarterdeck del 29-30 luglio 2026.
   ------------------------------------------------------------------------ */

const STAGE = {
  seq: 8,
  placeHistorical: "K’ie-p’an-to",
  placeModern: "Tashkurgan, Xinjiang, China",
  lat: 37.775,
  lon: 75.228,
  arrival: "630",
  confidence: "reconstructed",
  event:
    "After leaving the Pamir valley and traveling southeast through uninhabited, mountainous terrain for 500 li, the travelers arrived at the kingdom of K’ie-p’an-to, which corresponds to the area of modern Tashkurgan.",
  excerpt:
    "On leaving the midst of this valley and going south-east, along the route there is no inhabited place (no men or village). Ascending the mountains, traversing the side of precipices, encountering nothing but ice and snow, and thus going 500 li we arrive at the kingdom of K’ie-p’an-to.",
  citation:
    "Si-Yu-Ki: Buddhist Records of the Western World, Vols I–II (trans. Samuel Beal, 1884)",
  url: "https://archive.org/download/in.ernet.dli.2015.49333/2015.49333.Buddhist-Records-Of-The-Western-World--Vol-1-2_djvu.txt",
};

const SUMMARY =
  "The great overland journey: out of Chang’an past the frontier towers, along the northern Silk Road through Kucha and Kashgar, over the Tian Shan to Samarkand, south through Balkh and Bamiyan to Gandhara, then across northern India to Nalanda, where he studied for years, on to the far south and Ceylon, and home again by the southern desert route with six hundred and fifty-seven Buddhist texts.";

const WHAT_WAS_LOST =
  "Whatever notes Xuanzang carried are gone. What survives was set down after he came home, by a disciple taking his dictation, and it is arranged as a geography of countries rather than as a journey with dates — so the order of the route is read from the order of the text, and almost none of it can be dated to a day. He also left China illegally, against an imperial ban, so no official record of his departure was ever made.";

export default function SpecimenPage() {
  return (
    <div className={`spec ${cartouche.variable} ${text.variable} ${machine.variable}`}>
      <div className="spec-sheet">

        {/* ================= TESTATA ================= */}
        <header className="spec-masthead">
          <span className="spec-eyebrow">
            Terraveler &middot; saggio tipografico &middot; xxx&middot;vii&middot;mmxxvi
          </span>
          <h1>
            The ink of the <em>atlas</em>
          </h1>
          <p className="spec-lede">
            {
              "Three faces, five voices, one paper. The atlas and the desk are not two sites — they are one house, in which different people are speaking."
            }
          </p>
        </header>

        <nav className="spec-chapters">
          <a className="spec-chapter" href="/specimen" aria-current="page">
            i &middot; type
          </a>
          <a className="spec-chapter" href="/specimen/palette">
            ii &middot; colour
          </a>
        </nav>

        <div className="spec-note">
          <b>Cosa stai guardando.</b> Una pagina sola, con contenuto vero: la tappa 8 di
          Xuanzang come sta in <b>data/xuanzang-629.json</b>, e il registro del Quarterdeck
          come l&rsquo;hai fotografato. La tavolozza è <b>identica</b> a quella di oggi — parchment,
          ink, brass, bordeaux — perché il colore è l&rsquo;unico livello che nel tuo CSS
          funziona già. Cambia tutto il resto: caratteri, scala, ritmo, filetti, gerarchia.
        </div>

        <hr className="spec-rule-double" />

        {/* ================= I · LE TRE VOCI ================= */}
        <section>
          <span className="spec-eyebrow">I &middot; le tre famiglie</span>

          <div className="spec-voice">
            <div className="spec-voice-label">
              <span className="spec-margin-note">i &middot; il cartiglio</span>
              <span className="spec-machine">Cormorant Garamond</span>
            </div>
            <div>
              <div className="spec-voice-sample is-cartouche">
                Xuanzang, <em>629</em>
              </div>
              <p className="spec-voice-role">
                {
                  "Un Garamond ridisegnato per i corpi grandi: contrasto alto, grazie affilate, la qualità di un frontespizio inciso. Titoli, nomi dei viaggi, le cifre che contano. Mai sotto i 24px — sotto quella soglia si sfalda."
                }
              </p>
            </div>
          </div>

          <div className="spec-voice">
            <div className="spec-voice-label">
              <span className="spec-margin-note">ii &middot; il testo</span>
              <span className="spec-machine">EB Garamond</span>
            </div>
            <div>
              <div className="spec-voice-sample is-text">
                {"Ascending the mountains, traversing the side of "}
                <em>precipices</em>
              </div>
              <p className="spec-voice-role">
                {
                  "La narrazione, e — in corsivo, corpo maggiore, filetto ottone — le citazioni verbatim. Stesso scheletro del cartiglio a un’altra dimensione ottica: la coerenza è garantita per costruzione, non per disciplina."
                }
              </p>
            </div>
          </div>

          <div className="spec-voice">
            <div className="spec-voice-label">
              <span className="spec-margin-note">iii &middot; la macchina</span>
              <span className="spec-machine">IBM Plex Mono</span>
            </div>
            <div>
              <div className="spec-voice-sample is-machine">37.775 N / 75.228 E</div>
              <p className="spec-voice-role">
                {
                  "Non “tecnologico”: è la macchina da scrivere e il telegrafo, il momento in cui il registro di bordo ha smesso di essere manoscritto. Log, tracce AXIS, verdetti, coordinate, identificativi. Il desk non è un’app moderna incollata a un atlante antico — è la stanza della telescrivente della stessa nave."
                }
              </p>
            </div>
          </div>

          <div className="spec-scale">
            <span className="spec-margin-note" style={{ alignSelf: "center" }}>
              la scala &middot; ragione 1.2
            </span>
            <span style={{ fontSize: "var(--step--1)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-0)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-1)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-2)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-3)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-4)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-5)" }}>Aa</span>
            <span style={{ fontSize: "var(--step-6)" }}>Aa</span>
          </div>

          <div className="spec-note">
            <b>Nove corpi, non venti.</b> Oggi <b>globals.css</b> ne usa una ventina fra 9pt e
            15px, a passi di mezzo pixel — che è il modo esatto per non avere gerarchia. E il
            corpo base qui è più grande, non più piccolo: Garamond ha x-height bassa e chiede
            spazio. I 13px di oggi sono il motivo per cui la pagina sembra compressa.
          </div>
        </section>

        <hr className="spec-rule-double" />

        {/* ================= II · REGISTRO A — L'ATLANTE ================= */}
        <section>
          <span className="spec-eyebrow">II &middot; registro a &middot; l&rsquo;atlante</span>

          <div className="spec-atlas">
            <aside className="spec-atlas-margin">
              <div className="spec-margin-note">
                stage {STAGE.seq}
                <br />
                of xxxviii
              </div>
              <div className="spec-margin-note">
                {STAGE.lat}&deg; n
                <br />
                {STAGE.lon}&deg; e
              </div>
              <div className="spec-margin-note">arr. {STAGE.arrival}</div>
              <div>
                <span className="spec-conf">{STAGE.confidence}</span>
              </div>
              <div className="spec-margin-note">
                evidence
                <br />
                contemporary
                <br />
                testimony
              </div>
            </aside>

            <div className="spec-atlas-body">
              <h2 className="spec-voyage-title">
                Xuanzang&rsquo;s Journey to the <em>Western Regions</em>
              </h2>

              <div className="spec-dateline">
                <span className="spec-machine">629 &mdash; 645</span>
                <span className="spec-institution">on foot, by horse and by camel</span>
              </div>

              <p className="spec-prose has-dropcap">{SUMMARY}</p>

              <div className="spec-stage-head">
                <span className="spec-machine" style={{ color: "var(--brass)" }}>
                  viii
                </span>
                <h3>{STAGE.placeHistorical}</h3>
                <span className="spec-institution">{STAGE.placeModern}</span>
              </div>

              <p className="spec-prose">{STAGE.event}</p>

              <figure className="spec-quote">
                <span className="spec-quote-mark" aria-hidden="true">
                  &ldquo;
                </span>
                <blockquote>{STAGE.excerpt}</blockquote>
              </figure>
              <div className="spec-attrib spec-machine">
                {STAGE.citation}
                <br />
                <a href={STAGE.url} rel="noreferrer">
                  archive.org &rarr; 2015.49333
                </a>
              </div>

              <div className="spec-lost">
                <span className="spec-margin-note" style={{ color: "var(--accent)" }}>
                  what was lost
                </span>
                <p>{WHAT_WAS_LOST}</p>
              </div>
            </div>
          </div>

          <div className="spec-note">
            <b>Quattro voci in una tappa.</b> La macchina annuncia (stage, coordinate,
            confidenza), l&rsquo;atlante racconta, il viaggiatore parla in corsivo dietro un
            filetto d&rsquo;ottone, l&rsquo;archivio firma a margine. Il lettore capisce chi parla senza
            leggere. La colonna di marginalia a sinistra è la mossa singola che sposta la
            pagina da <b>sito web</b> a <b>edizione critica</b>.
          </div>
        </section>

        <hr className="spec-rule-double" />

        {/* ================= III · REGISTRO B — IL DESK ================= */}
        <section>
          <span className="spec-eyebrow">III &middot; registro b &middot; il desk</span>

          <DeskHeading
            eyebrow="Terraveler · editorial desk"
            title="Quarterdeck"
            aside={<span className="spec-machine" style={{ color: "var(--ink-faint)" }}>carta v0.5 · in force</span>}
          />

          <DeskStanding
            demands={[
              { label: "awaiting desk", n: 0 },
              { label: "in peer review", n: 1 },
              { label: "claimed gaps, unfinished", n: 1 },
            ]}
            ledger={[
              { label: "approved", n: 18 },
              { label: "rejected", n: 6 },
              { label: "reviews given", n: 3 },
              { label: "open gaps", n: 4 },
              { label: "crew", n: 8, suffix: " active" },
              { label: "suspended", n: 1 },
            ]}
          />

          <h3 className="dk-section-title">Ship&rsquo;s log</h3>
          <ShipsLog feed={DESK_FEED} />

          <div className="spec-note">
            <b>Tre cose cambiate, tutte di significato.</b> <b>Uno:</b> nove tessere identiche
            diventano tre cifre che chiedono un&rsquo;azione più una riga di libro mastro per la
            storia — <b>18 approved</b> non ha lo stesso peso di <b>0 awaiting</b>, perché non
            chiede niente. <b>Due:</b> nel registro la macchina è monospazio e il ragionamento
            umano resta serif, quindi il <em>perché</em> di un verdetto si legge come prosa e il{" "}
            <em>record</em> come dato. <b>Tre:</b> le quattro correzioni identiche collassano in
            una con il conteggio a lato — la ripetizione era un problema di content design, non
            di CSS.
          </div>
        </section>

        <hr className="spec-rule-double" />

        {/* ================= IV · PRIMA / DOPO ================= */}
        <section>
          <span className="spec-eyebrow">IV &middot; prima e dopo</span>

          <div className="spec-compare">
            <figure>
              <figcaption className="spec-margin-note">oggi &middot; in produzione</figcaption>
              <div className="spec-before">
                <div className="spec-before-row">
                  <div className="spec-before-tile">
                    <div className="n">0</div>
                    <div className="l">Awaiting desk</div>
                  </div>
                  <div className="spec-before-tile">
                    <div className="n">1</div>
                    <div className="l">In peer review</div>
                  </div>
                  <div className="spec-before-tile">
                    <div className="n">18</div>
                    <div className="l">Approved</div>
                  </div>
                </div>
                <div style={{ fontWeight: "bold" }}>peer-review · review → confirm · #27</div>
                <div style={{ fontSize: 12 }}>
                  seq1.claim1 (Portsmouth departure): supported
                </div>
              </div>
            </figure>

            <figure>
              <figcaption className="spec-margin-note">proposta</figcaption>
              <div
                style={{
                  border: "1px solid var(--rule-hair)",
                  borderRadius: "var(--radius-2)",
                  padding: "var(--space-5)",
                }}
              >
                <div style={{ display: "flex", gap: "var(--space-6)" }}>
                  <div className="spec-demand is-idle">
                    <span className="spec-demand-n" style={{ fontSize: "var(--step-5)" }}>
                      0
                    </span>
                    <span className="spec-demand-l spec-institution">awaiting desk</span>
                  </div>
                  <div className="spec-demand is-live">
                    <span className="spec-demand-n" style={{ fontSize: "var(--step-5)" }}>
                      1
                    </span>
                    <span className="spec-demand-l spec-institution">in peer review</span>
                  </div>
                </div>
                <div
                  className="spec-ledger spec-machine"
                  style={{ marginTop: "var(--space-4)", borderBottom: 0, paddingBottom: 0 }}
                >
                  <span>
                    approved <b>18</b>
                  </span>
                </div>
                <div
                  className="spec-entry is-peer"
                  style={{ gridTemplateColumns: "1fr", marginTop: "var(--space-4)" }}
                >
                  <div>
                    <span className="spec-entry-actor">peer-review</span>{" "}
                    <span className="spec-entry-action spec-machine">
                      review &rarr; confirm &middot; #27
                    </span>
                    <div className="spec-entry-payload">
                      <div className="spec-machine">
                        seq1.claim1 (Portsmouth departure): supported
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </figure>
          </div>
        </section>

        <hr className="spec-rule-double" />

        {/* ================= V · COSA RESTA UGUALE ================= */}
        <section>
          <span className="spec-eyebrow">V &middot; la carta condivisa</span>
          <p style={{ maxWidth: "var(--measure)", fontSize: "var(--step-2)", fontStyle: "italic" }}>
            {
              "Fra i due registri non cambia nulla di ciò che tiene insieme un sito: la carta e la sua grana, i colori, i filetti, la griglia, la scala tipografica, i raggi, la misura di riga. Cambia solo quanto spesso parla la macchina — poco nell’atlante, spesso al desk. Per questo il desk sembra il retrobottega della stessa casa editrice invece di un secondo prodotto."
            }
          </p>

          <hr className="spec-rule-hair" />

          <div className="spec-ledger spec-machine" style={{ borderBottom: 0 }}>
            <span>
              cormorant garamond <b>ofl</b>
            </span>
            <span>
              eb garamond <b>ofl</b>
            </span>
            <span>
              ibm plex mono <b>ofl</b>
            </span>
            <span>
              subset latin &middot; <b>240 kb</b> per sei tagli
            </span>
            <span>
              oggi in produzione &middot; <b>1.2 mb</b> per uno
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
