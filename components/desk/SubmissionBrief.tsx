import Icon from "@/components/Icon";

/* What is actually being proposed.
 *
 * The desk showed a submission as a raw JSON payload behind a disclosure — so
 * deciding whether to publish something meant reading a serialised object and
 * holding its shape in your head. That is a fine record and a poor question.
 * The record stays exactly where it was, below and collapsed, because an audit
 * trail that cannot be inspected is not one; this sits above it and answers
 * "what am I approving".
 *
 * Every line here is derived from the payload rather than written into it, so
 * a brief cannot flatter a submission the payload does not support. Where a
 * field is missing the brief says so — a draft with no quotations is a fact
 * the desk needs, not a gap to leave blank.
 */

type Plate = { url?: string; caption?: string; credit?: string; license?: string; source_url?: string };
type Waypoint = {
  seq?: number;
  place_historical?: string;
  place_modern?: string;
  latitude?: number;
  longitude?: number;
  arrival_date?: string;
  confidence?: string;
  excerpt?: string;
  diary_excerpt?: string;
  claims?: unknown[];
  plates?: Plate[];
};

const KIND: Record<string, string> = {
  source: "a source to cite",
  image: "an image to show",
  coordinate: "a coordinate to correct",
  date: "a date to correct",
  ethnography: "a perspective to add",
  correction: "a correction",
  other: "something else",
};

function host(u?: string): string | null {
  if (!u) return null;
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; }
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export default function SubmissionBrief({
  type,
  payload,
}: {
  type: string;
  payload: any;
}) {
  if (!payload || typeof payload !== "object") return null;

  /* ---- a suggestion is already prose; it only needs framing --------------- */
  if (type === "content-suggestion") {
    const what = KIND[String(payload.content_type)] ?? "a suggestion";
    return (
      <section className="sb">
        <p className="sb-lede">
          <span className="sb-verb">Proposes {what}</span>
          {payload.voyage && (
            <>
              {" for "}
              <span className="dk-id">{payload.voyage}</span>
            </>
          )}
          {payload.waypoint != null && (
            <>
              {", at stage "}
              <span className="dk-id">{payload.waypoint}</span>
            </>
          )}
          .
        </p>
        {payload.idea && <p className="sb-idea">{String(payload.idea)}</p>}
        <p className="sb-note">
          Nothing is published by approving this. A suggestion becomes work for a Scribe;
          the draft it produces comes back here on its own.
        </p>
      </section>
    );
  }

  /* ---- a draft: count what it would put into the atlas -------------------- */
  const wps: Waypoint[] = Array.isArray(payload.waypoints) ? payload.waypoints : [];
  if (wps.length === 0) return null;

  const seqs = wps.map((w) => w.seq).filter((n): n is number => typeof n === "number");
  const quoted = wps.filter((w) => (w.excerpt ?? w.diary_excerpt ?? "").trim().length > 0);
  const plates = wps.flatMap((w) => (Array.isArray(w.plates) ? w.plates : []));
  const claims = wps.reduce((n, w) => n + (Array.isArray(w.claims) ? w.claims.length : 0), 0);

  const confidences = new Map<string, number>();
  for (const w of wps) {
    const c = w.confidence ?? "unstated";
    confidences.set(c, (confidences.get(c) ?? 0) + 1);
  }

  const licences = new Map<string, number>();
  for (const p of plates) {
    const l = (p.license ?? "unstated").toLowerCase();
    licences.set(l, (licences.get(l) ?? 0) + 1);
  }

  const sources = new Set<string>();
  for (const w of wps) for (const p of w.plates ?? []) {
    const h = host(p.source_url) ?? host(p.url);
    if (h) sources.add(h);
  }

  return (
    <section className="sb">
      <p className="sb-lede">
        <span className="sb-verb">
          Would add {plural(wps.length, "stage")}
        </span>
        {payload.meta?.target_voyage && (
          <>
            {" to "}
            <span className="dk-id">{payload.meta.target_voyage}</span>
          </>
        )}
        {seqs.length > 0 && (
          <>
            {", "}
            {seqs.length === 1 ? "stage " : "stages "}
            <span className="dk-id">
              {Math.min(...seqs)}
              {seqs.length > 1 && `–${Math.max(...seqs)}`}
            </span>
          </>
        )}
        .
      </p>

      <dl className="sb-figures">
        <div>
          <dt>in the traveller&rsquo;s words</dt>
          <dd className={quoted.length === 0 ? "is-none" : undefined}>
            {quoted.length === 0 ? "none" : `${quoted.length} of ${wps.length}`}
          </dd>
        </div>
        <div>
          <dt>plates</dt>
          <dd className={plates.length === 0 ? "is-none" : undefined}>
            {plates.length === 0 ? "none" : plates.length}
          </dd>
        </div>
        <div>
          <dt>claims to check</dt>
          <dd className={claims === 0 ? "is-none" : undefined}>{claims === 0 ? "none" : claims}</dd>
        </div>
      </dl>

      <ul className="sb-lines">
        <li>
          <span className="sb-key">confidence</span>
          <span>
            {[...confidences].map(([c, n]) => `${n} ${c}`).join(" · ")}
          </span>
        </li>
        {plates.length > 0 && (
          <li>
            <span className="sb-key">licences</span>
            <span>{[...licences].map(([l, n]) => `${n} ${l}`).join(" · ")}</span>
          </li>
        )}
        {sources.size > 0 && (
          <li>
            <span className="sb-key">cites</span>
            <span>{[...sources].join(" · ")}</span>
          </li>
        )}
      </ul>

      {quoted.length === 0 && (
        <p className="sb-warn">
          <Icon name="hourglass" size={13} />
          No stage carries a verbatim quotation. That is allowed and sometimes the
          truth — but it is the thing to weigh before this sails.
        </p>
      )}
    </section>
  );
}
