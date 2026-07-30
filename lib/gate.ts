import { CARTA_VERSION } from "@/lib/carta";

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
  // Wherever the wiki projects run, in every language they run in.
  "wikisource.org", "wikipedia.org", "wikimedia.org", "wikidata.org",
  // Anglophone and general
  "gutenberg.org", "gutendex.com", "archive.org", "hathitrust.org", "loc.gov",
  "davidrumsey.com", "biodiversitylibrary.org", "europeana.eu",
  // French
  "gallica.bnf.fr", "persee.fr", "manioc.org",
  // Spanish
  "bne.es", "cervantesvirtual.com", "pares.cultura.gob.es", "memoriachilena.gob.cl",
  // Portuguese
  "purl.pt", "arquivos.pt", "bn.gov.br",
  // Italian
  "internetculturale.it", "liberliber.it",
  // German-speaking
  "digitale-sammlungen.de", "deutsche-digitale-bibliothek.de",
  "staatsbibliothek-berlin.de", "e-rara.ch", "onb.ac.at",
  // Dutch, Nordic, Polish
  "delpher.nl", "kb.nl", "rijksmuseum.nl", "runeberg.org", "nb.no", "polona.pl",
  // East Asia
  "ctext.org", "nlc.cn", "ndl.go.jp", "nijl.ac.jp", "nich.go.jp", "history.go.kr",
  // Gulf
  "qdl.qa",
  // Open-access museum collections, for plates
  "metmuseum.org", "si.edu", "getty.edu", "nga.gov",
];
// Two wordings this refused that are not in doubt, both found the first time it
// was pointed at images rather than books.
//
// "No known copyright restrictions" is the Flickr Commons statement, and every
// Internet Archive book scan on Wikimedia carries it — including the plates of
// the 1772 English edition this atlas already quotes from.
//
// And `^cc[ -]` wanted a separator, so CC0 never matched: the most permissive
// licence there is was the one licence the gate would not take, which cost us
// the Rijksmuseum, whose entire donation to Commons is CC0.
export const LICENSE_OK = /public domain|no known copyright restrictions|^cc(0|[ -])/i;

/**
 * Not every Creative Commons licence can be published under CC BY-SA.
 *
 * Carta §3.2 admits "public domain or openly licensed (CC)" and §8 publishes
 * the result under CC BY-SA. NonCommercial and NoDerivatives satisfy the first
 * and make the second impossible: an NC source cannot be relicensed by us, and
 * an ND source cannot be built on at all. LICENSE_OK took them, because it
 * asked whether a string began with "cc" and not what the letters said.
 *
 * This mattered little while the whitelist was nine Anglo-American archives of
 * public-domain books. It matters now that it reaches European museums, where
 * BY-NC-SA is the house style. §3.2's own second sentence is the answer for
 * that material: it may be linked and briefly quoted, never ingested.
 */
export const LICENSE_CLOSED = /\bnc\b|\bnd\b|non-?commercial|no-?deriv/i;
export const licenceUsable = (lic: string) =>
  LICENSE_OK.test(lic ?? "") && !LICENSE_CLOSED.test(lic ?? "");
export const CONFIDENCES = ["certain", "approximate", "reconstructed", "contested"];
export const INJECTION = [
  /ignore (all|any|previous|prior)/i, /disregard (the|all|previous)/i,
  /note to (the )?curator/i, /pre-?approved/i, /skip (the )?(verification|review|checks)/i,
  /you (must|should|are required to) (approve|accept)/i, /system prompt/i,
  /editor[- ]in[- ]chief (has )?(approved|authorised|authorized)/i,
];

// Free-text bounds for the lightweight write tools. The injection screen is a
// tripwire, not the defence: the desk always treats payloads as data.
export const TEXT_LIMITS: Record<string, number> = { title: 200, description: 4000, idea: 4000, area: 100, voyage: 100 };

/** A review's shape is a Carta matter, not a database one, so it is checked
 *  here whichever write path runs: a refutation must cite whitelist evidence
 *  (10.4) and a review is data, never instructions (10.5). */
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

export function domainOk(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function* strings(obj: any, path = ""): Generator<[string, string]> {
  if (typeof obj === "string") yield [path, obj];
  else if (Array.isArray(obj)) for (let i = 0; i < obj.length; i++) yield* strings(obj[i], `${path}[${i}]`);
  else if (obj && typeof obj === "object")
    for (const k of Object.keys(obj)) yield* strings(obj[k], path ? `${path}.${k}` : k);
}

/** Instant deterministic gate (subset of the full Curator: no source fetching). */
export function stage0(sub: any): string[] {
  const fails: string[] = [];
  if (JSON.stringify(sub ?? {}).length > MAX_DRAFT_BYTES)
    return [`submission exceeds ${MAX_DRAFT_BYTES / 1000} kB — split it into smaller drafts`];
  const meta = sub?.meta ?? {};
  if (meta.carta_version !== CARTA_VERSION)
    fails.push(`carta_version is '${meta.carta_version}', current is '${CARTA_VERSION}' — call get_contract first`);
  for (const f of ["type", "ideator", "scribe_model"]) if (!meta[f]) fails.push(`meta.${f} missing`);
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
      if (!LICENSE_OK.test(c.evidence.license ?? "")) fails.push(`${ctag}: licence not PD/CC (Carta 3.2)`);
      else if (LICENSE_CLOSED.test(c.evidence.license ?? ""))
        fails.push(`${ctag}: NC/ND cannot be republished under CC BY-SA (Carta 3.2, 8) — link and quote it instead`);
      if (c.evidence.source_url && !domainOk(c.evidence.source_url))
        fails.push(`${ctag}: source domain not whitelisted`);
    }
    // A plate is held to the standard of a quotation, because it is the thing
    // on a page easiest to lift and hardest to attribute. Two URLs are checked
    // rather than one: the pixels and the record page can sit on different
    // hosts, and only the record page can be read by a verifier.
    if ((w?.plates ?? []).length > MAX_PLATES_PER_WAYPOINT)
      fails.push(`${tag}: too many plates (max ${MAX_PLATES_PER_WAYPOINT})`);
    for (let pi = 0; pi < (w?.plates ?? []).length; pi++) {
      const p = w.plates[pi], ptag = `${tag}.plate${pi + 1}`;
      for (const f of ["url", "caption", "credit", "license", "source_url"])
        if (!p?.[f]) fails.push(`${ptag}: field '${f}' missing — a plate carries its provenance or it does not enter (Carta 3.1)`);
      if (!LICENSE_OK.test(p?.license ?? "")) fails.push(`${ptag}: licence not PD/CC (Carta 3.2)`);
      else if (LICENSE_CLOSED.test(p?.license ?? ""))
        fails.push(`${ptag}: NC/ND cannot be republished under CC BY-SA (Carta 3.2, 8) — link and quote it instead`);
      if (p?.url && !domainOk(p.url)) fails.push(`${ptag}: image domain not whitelisted`);
      if (p?.source_url && !domainOk(p.source_url)) fails.push(`${ptag}: source domain not whitelisted`);
      // Not a formality. The plate that fits a stage best is often drawn later
      // than it — Hodges saw Cape Town eighteen years after the Boudeuse moored
      // there — and a page that prints an image beside a date silently asserts
      // they are the same date. Undeclared, nobody catches it; declared, the
      // renderer can say so without depending on the caption being honest.
      if (!p?.date) fails.push(`${ptag}: field 'date' missing — say when the image was MADE, which is not always when the stage happened`);
    }
  }
  for (const [path, s] of strings(sub))
    if (INJECTION.some((p) => p.test(s))) { fails.push(`INJECTION ATTEMPT at '${path}' (Carta 6)`); break; }
  return fails;
}
