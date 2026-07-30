/* The Quarterdeck's presentational pieces.
 *
 * They live here rather than inline in app/desk/page.tsx for a reason beyond
 * tidiness: the desk is behind a session, so the only way to see a change to it
 * before shipping is to render the same components with fixture data. The
 * specimen at /specimen does exactly that — same code, different rows.
 *
 * The law they follow is in .claude/skills/terraveler-design/: the division is
 * who is speaking. A record is the machine and reads in mono; the reasoning a
 * human wrote inside that record is prose and stays serif. Hierarchy encodes
 * meaning, so a number that asks for an action does not weigh the same as a
 * number that is history.
 */

export type LogEntry = {
  submission_id: number | null;
  actor: string;
  action: string;
  verdict: string | null;
  findings: unknown;
  created_at: string;
};

/* ---- who is speaking -----------------------------------------------------
   The colour of the rule beside an entry says which kind of voice it is, so
   the log can be scanned before it is read. */
function voiceOf(actor: string): string {
  const a = actor.toLowerCase();
  if (a.startsWith("human")) return "human";
  if (a.startsWith("peer")) return "peer";
  if (a.startsWith("curator") || a.startsWith("editor")) return "curator";
  return "machine";
}

/* A finding is either a record or a piece of reasoning. There is no flag in
   the data that says which, so this is a heuristic and is meant to read as
   one: long, sentence-shaped text is somebody explaining themselves and gets
   the serif; anything short is a record and stays in the machine's voice.
   Wrong in either direction it is still legible — it just loses the cue. */
function isProse(s: string): boolean {
  return s.length > 110 && /[.:;] /.test(s);
}

/* An identifier stays the machine's voice even inside a sentence a human
   wrote. In hand-written JSX you mark those spans yourself; here the text
   arrives from the audit table, so the component has to find them — otherwise
   Garamond's oldstyle figures render v0.4 with a short zero and it reads as
   the letter o, which is precisely the confusion the rule exists to stop.
   Versions, snake_case names, file paths and submission numbers. */
const IDENT =
  /(\b[\w./-]+\.(?:ts|tsx|js|jsx|json|py|css|md|sql)\b|\bv?\d+\.\d+(?:\.\d+)?\b|\b\w+_\w+\b|#\d+)/g;

function withIdentifiers(text: string): React.ReactNode[] {
  return text.split(IDENT).map((part, i) =>
    i % 2 === 1 ? (
      <span className="dk-id" key={i}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function findingLines(findings: unknown): string[] {
  if (!Array.isArray(findings)) return [];
  return findings.map((f) => {
    if (Array.isArray(f)) return String(f[2] ?? f.join(" · "));
    if (f && typeof f === "object") return Object.values(f as object).join(" · ");
    return String(f);
  });
}

/* Consecutive entries identical in everything but which submission they name
   are one event that happened N times, not N events. Collapsing them is
   content design: the alternative is four identical paragraphs, which is what
   the desk showed before. */
type Grouped = LogEntry & { ids: number[]; count: number };

function collapse(feed: LogEntry[]): Grouped[] {
  const out: Grouped[] = [];
  for (const e of feed) {
    const prev = out[out.length - 1];
    const same =
      prev &&
      prev.actor === e.actor &&
      prev.action === e.action &&
      prev.verdict === e.verdict &&
      JSON.stringify(prev.findings) === JSON.stringify(e.findings);
    if (same) {
      prev.count += 1;
      if (e.submission_id != null) prev.ids.push(e.submission_id);
    } else {
      out.push({ ...e, count: 1, ids: e.submission_id != null ? [e.submission_id] : [] });
    }
  }
  return out;
}

function stamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: iso, time: "" };
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour12: false }),
  };
}

export function ShipsLog({ feed }: { feed: LogEntry[] }) {
  const rows = collapse(feed);
  if (rows.length === 0) {
    return <p className="dk-empty">The log is empty. Nothing has happened at this desk yet.</p>;
  }
  return (
    <div className="dk-log">
      {rows.map((e, i) => {
        const { day, time } = stamp(e.created_at);
        return (
          <article className={`dk-entry is-${voiceOf(e.actor)}`} key={i}>
            <div className="dk-when">
              {day}
              <br />
              {time}
            </div>
            <div className="dk-what">
              <span className="dk-actor">{e.actor}</span>{" "}
              <span className="dk-action">
                {e.action}
                {e.verdict ? ` → ${e.verdict}` : ""}
              </span>{" "}
              {e.count > 1 ? (
                <span className="dk-count">
                  ×{e.count}
                  {e.ids.length > 0 ? `  ${e.ids.map((n) => `#${n}`).join(" ")}` : ""}
                </span>
              ) : (
                e.ids.length > 0 && <span className="dk-action">· #{e.ids[0]}</span>
              )}

              {findingLines(e.findings).map((line, j) =>
                isProse(line) ? (
                  <p className="dk-reason" key={j}>
                    {withIdentifiers(line)}
                  </p>
                ) : (
                  <div className="dk-payload" key={j}>
                    {line}
                  </div>
                ),
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---- the numbers ---------------------------------------------------------
   Two kinds, and they must not look alike. A demand is something the desk is
   being asked to do; a ledger entry is what the desk has already done. Nine
   identical tiles said those were the same thing. */

export type Demand = { label: string; n: number };
export type LedgerEntry = { label: string; n: number; suffix?: string };

export function DeskStanding({ demands, ledger }: { demands: Demand[]; ledger: LedgerEntry[] }) {
  return (
    <>
      <div className="dk-demands">
        {demands.map((d) => (
          <div className={`dk-demand ${d.n > 0 ? "is-live" : "is-idle"}`} key={d.label}>
            <span className="dk-demand-n">{d.n}</span>
            <span className="dk-demand-l">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="dk-ledger">
        {ledger.map((l) => (
          <span key={l.label}>
            {l.label} <b>{l.n}</b>
            {l.suffix ?? ""}
          </span>
        ))}
      </div>
    </>
  );
}

export function DeskHeading({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="dk-head">
      <div>
        <span className="dk-eyebrow">{eyebrow}</span>
        <h1 className="dk-title">{title}</h1>
      </div>
      {aside}
    </header>
  );
}
