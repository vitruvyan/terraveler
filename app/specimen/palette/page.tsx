"use client";

import { useEffect, useState } from "react";
import "../specimen.css";

/* ---------------------------------------------------------------------------
   Questa pagina non contiene nessun valore di colore e nessun numero di
   contrasto. Legge i token calcolati dal browser e misura da sé: se qualcuno
   cambia un token in globals.css, la tavola lo dice al primo caricamento.
   È lo stesso principio della skill — punta alla fonte, non ricopiarla.
   ------------------------------------------------------------------------ */

/* ground = il fondo contro cui QUESTA riga va misurata.
   "none" = substrato, non porta testo.  "mark" = porta un segno, non parole:
   il rapporto si mostra lo stesso, ma non è una bocciatura.  "dark" = esiste
   per il fondo scuro, quindi misurarlo sulla pergamena darebbe un numero
   vero e inutile. */
type Row = { token: string; role: string; ground: "light" | "dark" | "none" | "mark" };

const SUBSTRATE: Row[] = [
  { token: "--parchment", role: "The page itself. The ground everything is measured against.", ground: "none" },
  { token: "--parchment-deep", role: "Recessed: inset wells, table stripes, the edge of a panel.", ground: "none" },
  { token: "--parchment-raised", role: "Lifted: a panel that sits above the page rather than in it.", ground: "none" },
];

const INK: Row[] = [
  { token: "--ink", role: "Primary. Narration, titles, anything that must be read first.", ground: "light" },
  { token: "--ink-soft", role: "Secondary. Marginalia, captions, the voice at the edge of the page.", ground: "light" },
  { token: "--ink-faint", role: "Tertiary. Where text must recede and still be read — reach for this instead of a raw rgba.", ground: "light" },
];

const MARK: Row[] = [
  { token: "--brass", role: "The mark, not the word: rules, borders, dots, underlines. Never carries text.", ground: "mark" },
  { token: "--brass-text", role: "The same hue taken to AA. Eyebrows, credits, source lines — the smallest text on the site.", ground: "light" },
  { token: "--brass-on-dark", role: "The mark where the ground is a hero shade or a starfield.", ground: "dark" },
];

const ACCENT: Row[] = [
  { token: "--accent", role: "The bordeaux identity. Marks: active state, emphasis, the rule beside a claim.", ground: "light" },
  { token: "--accent-deep", role: "Its pressed and hovered end.", ground: "light" },
  { token: "--btn", role: "The interactive ramp. Acts: the primary button and what it does under the cursor.", ground: "light" },
  { token: "--btn-deep", role: "Its pressed and hovered end.", ground: "light" },
];

const STATE: Row[] = [
  { token: "--state-wait", role: "Submitted. Sitting in the queue, waiting for the desk.", ground: "light" },
  { token: "--state-review", role: "With the Scribes, in peer review.", ground: "light" },
  { token: "--state-desk", role: "With the Curator, in human review.", ground: "light" },
  { token: "--state-ok", role: "Approved, active, supported.", ground: "light" },
  { token: "--state-changes", role: "Changes requested — the draft comes back.", ground: "light" },
  { token: "--state-no", role: "Rejected, suspended, refuted.", ground: "light" },
  { token: "--state-idle", role: "Nothing is being asked of you.", ground: "light" },
];

const DOMAIN: Row[] = [
  { token: "--route", role: "Map content only: the voyage line and the ship. A stroke and a fill, never a foreground on parchment.", ground: "none" },
];

/* Le righe della sezione scura. Ogni livello va ricontrollato là dentro: è
   proprio qui che questa pagina ha colto in fallo chi l'ha scritta, perché
   --state-changes era rimasto senza ridichiarazione e usciva a 3.29:1. */
const DARK_ROWS: Row[] = [
  ...INK,
  { token: "--brass-text", role: "On this ground the mark and the word can be the same value.", ground: "light" },
  { token: "--state-wait", role: "Submitted.", ground: "light" },
  { token: "--state-review", role: "In peer review.", ground: "light" },
  { token: "--state-desk", role: "In human review.", ground: "light" },
  { token: "--state-ok", role: "Approved.", ground: "light" },
  { token: "--state-changes", role: "Changes requested.", ground: "light" },
  { token: "--state-no", role: "Rejected.", ground: "light" },
];

const STATUSES = [
  ["submitted", "--state-wait"],
  ["peer-review", "--state-review"],
  ["human-review", "--state-desk"],
  ["approved", "--state-ok"],
  ["changes-requested", "--state-changes"],
  ["rejected", "--state-no"],
] as const;

/* --- WCAG 2.1 relative luminance + contrast, on resolved rgb() strings --- */
function rgb(str: string): [number, number, number] {
  const m = str.match(/-?[\d.]+/g);
  if (!m) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
function lum(c: string) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(c);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string) {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hex(c: string) {
  const [r, g, b] = rgb(c);
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

type Measured = Record<string, { hex: string; ratio: number }>;

/* Resolve a custom property to a real colour by letting the browser do it:
   getPropertyValue would hand back the literal `var(--ink-faint)` for the
   tokens that alias another token. */
function measure(scope: HTMLElement, tokens: string[], groundToken: string): Measured {
  const probe = document.createElement("span");
  probe.style.display = "none";
  scope.appendChild(probe);
  const read = (t: string) => {
    probe.style.color = `var(${t})`;
    return getComputedStyle(probe).color;
  };
  const ground = read(groundToken);
  const out: Measured = {};
  for (const t of tokens) {
    const c = read(t);
    out[t] = { hex: hex(c), ratio: ratio(c, ground) };
  }
  scope.removeChild(probe);
  return out;
}

function Verdict({ r, ground }: { r: number; ground: Row["ground"] }) {
  if (ground === "none") return <span className="spec-verdict is-na">surface</span>;
  if (ground === "mark") return <span className="spec-verdict is-na">mark only</span>;
  if (r >= 7) return <span className="spec-verdict is-aaa">AAA</span>;
  if (r >= 4.5) return <span className="spec-verdict is-aa">AA</span>;
  if (r >= 3) return <span className="spec-verdict is-lrg">AA large</span>;
  return <span className="spec-verdict is-fail">fails</span>;
}

/* Ogni riga è misurata contro il fondo che le compete: un token che vive sul
   campo stellato, confrontato con la pergamena, darebbe un numero esatto e
   privo di senso. `dark` viene dalla misurazione fatta dentro .space. */
function Table({ rows, light, dark }: { rows: Row[]; light: Measured; dark: Measured }) {
  return (
    <div>
      {rows.map((row) => {
        const d = row.ground === "dark" ? dark[row.token] : light[row.token];
        return (
          <div className="spec-swatch" key={row.token}>
            <div className="spec-chip" style={{ background: `var(${row.token})` }} />
            <div>
              <span className="spec-swatch-name">{row.token}</span>
              <span className="spec-swatch-hex">{d ? d.hex : "—"}</span>
            </div>
            <p className="spec-swatch-role" style={{ margin: 0 }}>
              {row.role}
            </p>
            <div className="spec-ratio">
              {d && row.ground !== "none" ? `${d.ratio.toFixed(2)}:1` : "—"}
              {row.ground === "dark" && (
                <span style={{ display: "block", color: "var(--ink-faint)", fontSize: "var(--step--2)" }}>
                  su fondo scuro
                </span>
              )}
            </div>
            <Verdict r={d ? d.ratio : 0} ground={row.ground} />
          </div>
        );
      })}
    </div>
  );
}

export default function PalettePage() {
  const [light, setLight] = useState<Measured>({});
  const [dark, setDark] = useState<Measured>({});

  useEffect(() => {
    const all = [...SUBSTRATE, ...INK, ...MARK, ...ACCENT, ...STATE, ...DOMAIN, ...DARK_ROWS].map((r) => r.token);
    setLight(measure(document.body, all, "--parchment"));
    const space = document.querySelector<HTMLElement>(".spec-dark-scope");
    if (space) setDark(measure(space, all, "--parchment"));
  }, []);

  return (
    <div className="spec">
      <div className="spec-sheet">
        <header className="spec-masthead">
          <span className="spec-eyebrow">
            Terraveler &middot; saggio della paletta &middot; capitolo ii
          </span>
          <h1>
            The colour of the <em>atlas</em>
          </h1>
          <p className="spec-lede">
            {
              "Four layers, and the layer a colour belongs to decides what it is allowed to do. Anything that carries a word clears 4.5:1; anything that only makes a mark does not have to."
            }
          </p>
        </header>

        <nav className="spec-chapters">
          <a className="spec-chapter" href="/specimen">
            i &middot; type
          </a>
          <a className="spec-chapter" href="/specimen/palette" aria-current="page">
            ii &middot; colour
          </a>
        </nav>

        <div className="spec-note">
          <b>Questa pagina si misura da sola.</b> Non contiene un solo valore di
          colore né un solo numero: legge i token calcolati dal browser e
          calcola il contrasto al caricamento. Se qualcuno cambia un token in{" "}
          <b>globals.css</b>, la tavola qui sotto lo dice — e se lo peggiora,
          lo accusa. È lo stesso principio della skill: puntare alla fonte
          invece di ricopiarla.
        </div>

        <hr className="spec-rule-double" />

        <section>
          <span className="spec-eyebrow">i &middot; substrato &middot; la carta</span>
          <p className="spec-lede" style={{ fontSize: "var(--step-1)", marginBottom: "var(--space-5)" }}>
            {"Non porta mai testo, quindi non ha un minimo di contrasto da rispettare."}
          </p>
          <Table rows={SUBSTRATE} light={light} dark={dark} />
        </section>

        <section style={{ marginTop: "var(--space-8)" }}>
          <span className="spec-eyebrow">ii &middot; inchiostro &middot; ciò che vi è scritto</span>
          <Table rows={INK} light={light} dark={dark} />
          <div className="spec-note">
            <b>Tre pesi, tutti AA.</b> Il terziario prima non esisteva: chi aveva
            bisogno di far arretrare un testo prendeva il brass o un{" "}
            <b>rgba</b> a caso, ed è così che nascono i 285 letterali di colore
            ancora nel foglio.
          </div>
        </section>

        <section style={{ marginTop: "var(--space-8)" }}>
          <span className="spec-eyebrow">iii &middot; il marchio &middot; l&rsquo;ottone</span>
          <Table rows={MARK} light={light} dark={dark} />

          <div className="spec-brass-demo">
            <div>
              <span className="spec-brass-label">--brass · il marchio</span>
              <div className="spec-brass-sample" style={{ color: "var(--brass)" }}>
                Typus Orbis Terrarum · 1570 · Abraham Ortelius
              </div>
              <p className="spec-swatch-role" style={{ marginTop: "var(--space-4)" }}>
                {"Sotto AA. Va bene per un filetto o un bordo, non per una parola."}
              </p>
            </div>
            <div>
              <span className="spec-brass-label">--brass-text · la parola</span>
              <div className="spec-brass-sample" style={{ color: "var(--brass-text)" }}>
                Typus Orbis Terrarum · 1570 · Abraham Ortelius
              </div>
              <p className="spec-swatch-role" style={{ marginTop: "var(--space-4)" }}>
                {"Stessa tinta, H35°, portata a 4.5:1. Venti regole di testo sono passate qui."}
              </p>
            </div>
          </div>

          <div className="spec-note">
            <b>Era il difetto vero della paletta</b>, non una casella da
            spuntare: il brass è il colore degli occhielli, dei crediti e delle
            fonti — cioè del <b>testo più piccolo del sito</b>, già a 10 e 11px.
            A 3.17:1, su uno schermo al sole, non si legge.
          </div>
        </section>

        <section style={{ marginTop: "var(--space-8)" }}>
          <span className="spec-eyebrow">iv &middot; accento &middot; il bordeaux</span>
          <Table rows={ACCENT} light={light} dark={dark} />
          <div className="spec-note">
            <b>Due rampe, non cinque rossi.</b> <b>--accent</b> segna,{" "}
            <b>--btn</b> agisce. Nel foglio oggi si sovrappongono — separarle
            regola per regola sarebbe molto lavoro con resa visiva quasi nulla,
            quindi la sovrapposizione è registrata come debito nella skill
            invece di essere rimescolata adesso.
          </div>
        </section>

        <section style={{ marginTop: "var(--space-8)" }}>
          <span className="spec-eyebrow">v &middot; stato &middot; dove sta una proposta</span>
          <Table rows={STATE} light={light} dark={dark} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
            {STATUSES.map(([label, token]) => (
              <span
                key={label}
                className="spec-verdict"
                style={{ color: `var(${token})`, textTransform: "none", letterSpacing: "0.04em" }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="spec-note">
            <b>Vivevano come sette hex scritti a mano</b> in{" "}
            <b>app/desk/page.tsx</b>, e <b>quattro su sette</b> fallivano AA
            mentre facevano da colore del testo del badge che li portava.
            Stesse tinte, portate a 4.5:1, e ora sono token.
          </div>
        </section>

        <section style={{ marginTop: "var(--space-8)" }}>
          <span className="spec-eyebrow">vi &middot; dominio &middot; ciò che appartiene all&rsquo;atlante</span>
          <Table rows={DOMAIN} light={light} dark={dark} />
          <div className="spec-note">
            <b>--sea è stato rimosso.</b> Era dichiarato in due temi e non usato
            da nessuna parte: zero occorrenze in tutto il repo. Un token morto
            in una paletta è peggio di un colore mancante, perché il prossimo
            che passa lo prende per buono.
          </div>
        </section>

        <hr className="spec-rule-double" />

        <section>
          <span className="spec-eyebrow">vii &middot; lo stesso su fondo scuro</span>
          <p className="spec-swatch-role" style={{ fontSize: "var(--step-1)", maxWidth: "var(--measure)" }}>
            {
              "Un token che passa AA sulla pergamena fallisce su un campo stellato. Il tema .space non eredita la paletta: la ridichiara, stesse tinte riportate ad AA contro il proprio fondo. I numeri qui sotto sono misurati dentro quel tema."
            }
          </p>
          <div className="spec-dark space spec-dark-scope">
            <Table rows={DARK_ROWS} light={dark} dark={dark} />
          </div>
        </section>

        <hr className="spec-rule-double" />

        <section>
          <span className="spec-eyebrow">viii &middot; la legge</span>
          <ul style={{ maxWidth: "var(--measure)", lineHeight: 1.6, paddingLeft: "1.1em" }}>
            <li>{"Il livello a cui un colore appartiene decide cosa può fare. Un substrato non porta parole; un marchio non porta parole; un inchiostro sì."}</li>
            <li>{"Qualsiasi cosa porti testo, a qualsiasi corpo, sta sopra 4.5:1. Non 3:1 perché «è grande»: sul sito quel testo è quasi sempre a 10 o 11px."}</li>
            <li>{"Mai un hex grezzo in un componente. Se manca un colore si aggiunge un token — è così che i 285 letterali rientrano invece di moltiplicarsi."}</li>
            <li>{"Ogni tema ridichiara ogni livello. L'ereditarietà su un fondo diverso è il modo più rapido per rompere il contrasto senza accorgersene."}</li>
            <li>{"Un token non usato si cancella."}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
