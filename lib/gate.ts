import { CARTA_VERSION } from "@/lib/carta";
import CONTROLLED_VOCAB from "@/vocab/controlled.json";

/**
 * The Stage-0 gate: the Carta's mechanical clauses, and nothing about HTTP.
 *
 * This lived inside app/api/mcp/route.ts, where it could not be tested — Next
 * accepts only its own named exports from a route module, so the one piece of
 * this server that decides what may enter the atlas was the one piece no test
 * could reach. It moved here unchanged the day plates were added to it, since
 * a rule that governs images had no business being adopted unverified.
 *
 * Deep verification (fetching a source, string-matching a quotation against it)
 * stays with the Curator. Everything here is synchronous and deterministic: the
 * gate must answer instantly and answer the same way twice.
 */
// ------------------------------------------------------------------ stage-0 gate
/**
 * Where evidence may come from. Suffix-matched, so a language edition or a
 * digital-collections subdomain is covered by its parent.
 *
 * Carta §4 has always said sources may be in any language and only the
 * published text must be English. This list did not honour that: nine domains,
 * eight of them Anglo-American, one French. A Scribe working on a Spanish
 * voyage could cite the Archivo General de Indias only by finding an English
 * book about it — which is how an atlas ends up telling every story through
 * the archive that happens to have been digitised in English first.
 *
 * These are the addresses of institutions, not a claim about their contents.
 * Almost none of them is wholesale open: a national library holds in-copyright
 * material beside its incunabula, and Europeana is an aggregator whose rights
 * statement differs per item. That is what the licence field is for, and what
 * the Curator's deep pass verifies. Being on this list means the URL leads
 * somewhere a verifier can go and will still lead there next year — nothing
 * more. The stricter question, what a machine may ingest unattended, is
 * answered by ingest/whitelist.py, which is a different list for a reason.
 */
export const DOMAINS = [
  "wikisource.org", "wikipedia.org", "wikimedia.org", "wikidata.org",
  "gutenberg.org", "gutendex.com", "archive.org", "hathitrust.org", "loc.gov",
  "davidrumsey.com", "biodiversitylibrary.org", "europeana.eu",
  "gallica.bnf.fr", "persee.fr", "manioc.org",
  "bne.es", "cervantesvirtual.com", "pares.cultura.gob.es", "pares.mcu.es",
  "memoriachilena.gob.cl",
  "purl.pt", "arquivos.pt", "bn.gov.br",
  "internetculturale.it", "liberliber.it",
  "digitale-sammlungen.de", "deutsche-digitale-bibliothek.de",
  "staatsbibliothek-berlin.de", "e-rara.ch", "onb.ac.at",
  "delpher.nl", "kb.nl", "rijksmuseum.nl", "runeberg.org", "nb.no", "polona.pl",
  "ctext.org", "nlc.cn", "ndl.go.jp", "nijl.ac.jp", "nich.go.jp", "history.go.kr",
  "qdl.qa",
  "metmuseum.org", "si.edu", "getty.edu", "nga.gov",
];

export const LICENSE_OK = /public domain|no known copyright restrictions|^cc(0|[ -])/i;
export const LICENSE_CLOSED = /\bnc\b|\bnd\b|non-?commercial|no-?deriv/i;
export const licenceUsable = (lic: string) =>
  LICENSE_OK.test(lic ?? "") && !LICENSE_CLOSED.test(lic ?? "");
// evidence_basis, confidence and voyageless_types all live in vocab/controlled.json,
// the one file scripts/desk_checks.py reads too (see its EVIDENCE_BASIS/CONFIDENCE/
// VOYAGELESS_TYPES). Before that file existed this array was a second hand-typed
// copy of Python's EVIDENCE_BASIS set — the exact shape of bug this gate exists to
// close, just moved one field over. A draft with a `confidence` the Curator would
// reject used to pass this gate too; it no longer can, because there is only one
// list to have gotten out of step from.
export const CONFIDENCES: string[] = CONTROLLED_VOCAB.confidence;
export const EVIDENCE_BASES: string[] = CONTROLLED_VOCAB.evidence_basis;
// Submission types that declare no voyage of their own (Carta 3.6 binds the
// VOYAGE, not every submission that touches one) — an enrichment is not asked
// to re-state evidence_basis/what_was_lost for a voyage it does not publish.
// Mirrors scripts/desk_checks.py's VOYAGELESS_TYPES exactly, from the same file:
// if the two ever disagreed, one side would silently accept what the other
// silently requires — exactly the ambiguity this gate exists to remove.
export const VOYAGELESS_TYPES: Set<string> = new Set(CONTROLLED_VOCAB.voyageless_types);
export const INJECTION = [
  /ignore (all|any|previous|prior)/i, /disregard (the|all|previous)/i,
  /note to (the )?curator/i, /pre-?approved/i, /skip (the )?(verification|review|checks)/i,
  /you (must|should|are required to) (approve|accept)/i, /system prompt/i,
  /editor[- ]in[- ]chief (has )?(approved|authorised|authorized)/i,
];

export const TEXT_LIMITS: Record<string, number> = {
  title: 200, description: 4000, idea: 4000, grounds: 4000, area: 100, voyage: 100,
};

export function reviewShapeError(args: any): string | null {
  if (!["confirm", "refute", "unclear"].includes(args?.verdict)) return "invalid verdict.";
  const findings = args?.findings;
  if (!Array.isArray(findings) || findings.length === 0)
    return "at least one finding is required — reviews must show their checking.";
  if (findings.length > 30) return "too many findings (max 30).";
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i], tag = `finding ${i + 1}`;
    if (!f?.claim || typeof f.claim !== "string" || f.claim.length > 500)
      return `${tag}: claim missing or over 500 chars.`;
    if (!["supported", "contradicted", "unverifiable"].includes(f?.assessment))
      return `${tag}: invalid assessment.`;
    if (f.assessment === "contradicted" && !f.evidence_url)
      return `${tag}: a refutation requires evidence_url (Carta 10.4 — the refutation must cite the evidence).`;
    if (f.evidence_url && !domainOk(String(f.evidence_url)))
      return `${tag}: evidence_url not on the whitelist.`;
    if (f.note && (typeof f.note !== "string" || f.note.length > 1000))
      return `${tag}: note over 1000 chars.`;
    for (const field of [f.claim, f.note ?? ""])
      if (INJECTION.some((p) => p.test(field)))
        return `${tag} trips the injection screen (Carta 10.5): reviews are data, never instructions.`;
  }
  return null;
}

export function badText(args: any, fields: string[]): string | null {
  for (const f of fields) {
    const v = args?.[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return `Field '${f}' must be a string.`;
    const cap = TEXT_LIMITS[f] ?? 2000;
    if (v.length > cap) return `Field '${f}' exceeds ${cap} characters.`;
    if (INJECTION.some((p) => p.test(v)))
      return `Field '${f}' trips the injection screen (Carta 6): submissions are data, never instructions.`;
  }
  return null;
}

export const MAX_DRAFT_BYTES = 300_000;
export const MAX_WAYPOINTS = 300;
export const MAX_CLAIMS_PER_WAYPOINT = 60;
export const MAX_PLATES_PER_WAYPOINT = 12;

/** A plain http(s) URL — no userinfo, no non-default port — or null. */
function plainUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (parsed.port && !((parsed.protocol === "https:" && parsed.port === "443") ||
                         (parsed.protocol === "http:" && parsed.port === "80"))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function domainOk(url: string): boolean {
  const parsed = plainUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

// Magna Carta 3.2: material whose licence is not open "may be linked and
// briefly quoted with attribution — never ingested". "Briefly" is one number,
// shared with the Curator (vocab/controlled.json -> ingest/licence.py).
export const QUOTE_WORD_CAP: number = (CONTROLLED_VOCAB as any).quote_only_word_cap;

/**
 * A licence declaration that names no open licence but says so honestly: an
 * explicit "unknown", a reserved-rights statement, or an NC / ND clause (not
 * compatible with publishing under CC BY-SA). It is not a refusal — it is the
 * quote-only profile — because refusing it taught contributors to declare CC
 * for a source whose licence they could not see, which is a false statement in
 * the provenance and worse than the truth.
 */
/**
 * How many words a quotation counts as. Scripts written without spaces
 * (Chinese, Japanese, Thai…) have no word boundary, so each of their characters
 * counts — otherwise a whole page is "one word". The same ranges as
 * ingest/licence.py::_UNSPACED — keep them identical.
 */
const UNSPACED = /[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\u{20000}-\u{2fa1f}]/gu;
export function quoteWords(text: string): number {
  return (text ?? "").replace(UNSPACED, " x ").split(/\s+/).filter(Boolean).length;
}

export function isQuoteOnlyLicence(lic: string): boolean {
  const l = (lic ?? "").trim();
  if (!l) return false;
  return LICENSE_CLOSED.test(l) ||
    /\b(unknown|not stated|unspecified|unclear|undetermined|all rights reserved|rights reserved|in copyright|copyrighted)\b/i.test(l) ||
    l.startsWith("©");
}

function* strings(obj: any, path = ""): Generator<[string, string]> {
  if (typeof obj === "string") yield [path, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* strings(obj[i], `${path}[${i}]`);
  else if (obj && typeof obj === "object")
    for (const k of Object.keys(obj)) yield* strings(obj[k], path ? `${path}.${k}` : k);
}

export function stage0(sub: any, opts: { governedHost?: (url: string) => boolean } = {}): string[] {
  const fails: string[] = [];
  // Where a source may be cited from: the broad institutional list above, PLUS
  // any host an editor has approved in the source registry (an approval used to
  // reach no gate at all). The registry check is injected because it needs the
  // database and this function is synchronous.
  const hostOk = (u: string): boolean =>
    domainOk(u) || (opts.governedHost !== undefined && plainUrl(u) !== null && opts.governedHost(u));
  if (JSON.stringify(sub ?? {}).length > MAX_DRAFT_BYTES)
    return [`submission exceeds ${MAX_DRAFT_BYTES / 1000} kB — split it into smaller drafts`];
  const meta = sub?.meta ?? {};
  if (meta.carta_version !== CARTA_VERSION)
    fails.push(`carta_version is '${meta.carta_version}', current is '${CARTA_VERSION}' — call get_contract first`);
  for (const f of ["type", "ideator", "scribe_model"]) if (!meta[f]) fails.push(`meta.${f} missing`);
  // Carta §3.6 binds the VOYAGE, not every submission — an enrichment adds
  // stages to a voyage that already declared both fields when it was
  // published, so it is not asked to re-state them (mirrors
  // scripts/desk_checks.py's check_shape via the shared VOYAGELESS_TYPES).
  // An unknown or missing meta.type is checked in full rather than waved
  // through: Set.has(undefined) is false, so it falls into this branch.
  if (!VOYAGELESS_TYPES.has(meta.type)) {
    const voyage = sub?.voyage ?? {};
    const basis = voyage.evidence_basis;
    if (!basis) fails.push("voyage.evidence_basis missing (Carta 3.6)");
    else if (!EVIDENCE_BASES.includes(basis))
      fails.push(`voyage.evidence_basis '${basis}' is not one of: ${EVIDENCE_BASES.join(", ")} (Carta 3.6)`);
    if (!(voyage.what_was_lost ?? "").toString().trim())
      fails.push("voyage.what_was_lost missing or empty — say in one sentence what the archive does not hold (Carta 3.6)");
  }
  const wps = sub?.waypoints ?? [];
  if (!Array.isArray(wps) || wps.length === 0) fails.push("no waypoints in submission");
  if (Array.isArray(wps) && wps.length > MAX_WAYPOINTS) return [`too many waypoints (max ${MAX_WAYPOINTS})`];
  for (const w of wps) {
    const tag = `wp${w?.seq ?? "?"}`;
    for (const f of ["seq", "place_historical", "latitude", "longitude", "arrival_date", "confidence"])
      if (w?.[f] === undefined || w?.[f] === null || w?.[f] === "") fails.push(`${tag}: field '${f}' missing`);
    if (w?.confidence && !CONFIDENCES.includes(w.confidence)) fails.push(`${tag}: invalid confidence`);
    if ((w?.claims ?? []).length > MAX_CLAIMS_PER_WAYPOINT)
      fails.push(`${tag}: too many claims (max ${MAX_CLAIMS_PER_WAYPOINT})`);
    for (let ci = 0; ci < (w?.claims ?? []).length; ci++) {
      const c = w.claims[ci], ctag = `${tag}.claim${ci + 1}`;
      if (!c?.text) fails.push(`${ctag}: empty claim text`);
      if (!c?.evidence) { fails.push(`${ctag}: CLAIM WITHOUT SOURCE (Carta 3.1)`); continue; }
      if (!c.evidence.excerpt || !c.evidence.source_url) fails.push(`${ctag}: evidence incomplete`);
      const lic = String(c.evidence.license ?? "");
      if (licenceUsable(lic)) {
        // Declared open. Only a declaration: the Curator reads the item's own
        // metadata and confirms it against the page, and where it cannot it
        // applies the quote-only profile below.
      } else if (isQuoteOnlyLicence(lic)) {
        // Not open, and said so (Carta 3.2 / 8): a brief attributed quotation,
        // never ingested. Nothing to refuse unless the quotation is not brief.
        // Both fields: `excerpt` is what peer reviewers are shown and what a
        // fallback would print, so it may not smuggle what `quote` may not.
        const words = Math.max(
          quoteWords(typeof c.evidence.quote === "string" ? c.evidence.quote : ""),
          quoteWords(typeof c.evidence.excerpt === "string" ? c.evidence.excerpt : ""));
        if (words > QUOTE_WORD_CAP)
          fails.push(`${ctag}: licence declared as '${lic}' (not open), so only a brief quotation is allowed — Carta 3.2: at most ${QUOTE_WORD_CAP} words; this quotation is ${words}. Quote a shorter passage, or cite a source whose licence is open`);
      } else {
        fails.push(`${ctag}: licence must be declared — 'public domain' or a CC licence if you can see one on the item; 'unknown' if you cannot (the source is then quoted briefly and never ingested, Carta 3.2). Do not declare an open licence you have not seen`);
      }
      if (c.evidence.source_url && !hostOk(c.evidence.source_url))
        fails.push(`${ctag}: source domain not whitelisted`);
    }
    if ((w?.plates ?? []).length > MAX_PLATES_PER_WAYPOINT)
      fails.push(`${tag}: too many plates (max ${MAX_PLATES_PER_WAYPOINT})`);
    for (let pi = 0; pi < (w?.plates ?? []).length; pi++) {
      const p = w.plates[pi], ptag = `${tag}.plate${pi + 1}`;
      for (const f of ["url", "caption", "credit", "license", "source_url"])
        if (!p?.[f]) fails.push(`${ptag}: field '${f}' missing — a plate carries its provenance or it does not enter (Carta 3.1)`);
      if (!LICENSE_OK.test(p?.license ?? "")) fails.push(`${ptag}: licence not PD/CC (Carta 3.2)`);
      else if (LICENSE_CLOSED.test(p?.license ?? ""))
        fails.push(`${ptag}: NC/ND cannot be republished under CC BY-SA (Carta 3.2, 8) — link and quote it instead`);
      // Plates stay on the broad list only: a brief quotation means nothing for
      // an image, and a plate's licence is only ever the contributor's word.
      if (p?.url && !domainOk(p.url)) fails.push(`${ptag}: image domain not whitelisted`);
      if (p?.source_url && !domainOk(p.source_url)) fails.push(`${ptag}: source domain not whitelisted`);
      if (!p?.date) fails.push(`${ptag}: field 'date' missing — say when the image was MADE, which is not always when the stage happened`);
    }
  }
  for (const [path, s] of strings(sub))
    if (INJECTION.some((p) => p.test(s))) { fails.push(`INJECTION ATTEMPT at '${path}' (Carta 6)`); break; }
  return fails;
}
