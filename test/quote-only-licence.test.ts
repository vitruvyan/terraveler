import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUOTE_WORD_CAP, domainOk, isQuoteOnlyLicence, licenceUsable, stage0 } from "../lib/gate";
import { CARTA_VERSION } from "../lib/carta";

/**
 * Magna Carta 3.2: material whose licence is not open "may be linked and
 * briefly quoted with attribution — never ingested". Stage-0 used to require
 * every claim to declare a PD/CC licence, so a contributor looking at a source
 * whose licence it could not see had exactly one way to proceed: declare one.
 * A false statement in the provenance. These pin the honest alternative — say
 * 'unknown' and quote briefly — and that it is not an escape hatch.
 */

const words = (n: number) => "I " + Array.from({ length: n - 1 }, (_, i) => `w${i}`).join(" ");
const claim = (evidence: Record<string, unknown>) => ({
  meta: { type: "waypoint-enrichment", ideator: "a human", scribe_model: "a model",
          carta_version: CARTA_VERSION, target_voyage: "boudeuse-1766" },
  waypoints: [{
    seq: 1, place_historical: "Somewhere", latitude: 1, longitude: 2, arrival_date: "1768-07-06",
    confidence: "certain",
    claims: [{ text: "A claim.", evidence: { excerpt: "context", source_title: "T", ...evidence } }],
  }],
});
const URL_OK = "https://gallica.bnf.fr/ark:/12148/x";
const licenceFindings = (sub: any, opts?: any) =>
  stage0(sub, opts).filter((f) => /licen[cs]e|words/i.test(f));

test("an honest 'unknown' is the quote-only profile, not a refusal", async (t) => {
  await t.test("declared unknown with a brief quotation passes the licence rule", () => {
    assert.deepEqual(licenceFindings(claim({ source_url: URL_OK, license: "unknown", quote: words(60) })), []);
  });

  await t.test("the cap is exactly the shared number, inclusive", () => {
    assert.deepEqual(licenceFindings(claim({ source_url: URL_OK, license: "unknown", quote: words(QUOTE_WORD_CAP) })), []);
    const over = licenceFindings(claim({ source_url: URL_OK, license: "unknown", quote: words(QUOTE_WORD_CAP + 1) }));
    assert.equal(over.length, 1);
    assert.match(over[0], new RegExp(`at most ${QUOTE_WORD_CAP} words; this quotation is ${QUOTE_WORD_CAP + 1}`));
  });

  await t.test("NC / ND and reserved-rights declarations are quote-only too, and capped alike", () => {
    for (const lic of ["CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-ND 4.0", "all rights reserved", "© Bibliothèque nationale", "In copyright", "not stated"]) {
      assert.equal(isQuoteOnlyLicence(lic), true, lic);
      assert.deepEqual(licenceFindings(claim({ source_url: URL_OK, license: lic, quote: words(10) })), [], lic);
      assert.equal(licenceFindings(claim({ source_url: URL_OK, license: lic, quote: words(200) })).length, 1, lic);
    }
  });

  await t.test("a claim with no quotation at all quotes nothing, so nothing is capped", () => {
    assert.deepEqual(licenceFindings(claim({ source_url: URL_OK, license: "unknown" })), []);
  });

  await t.test("an open licence declaration is not capped here (the Curator confirms it against the page)", () => {
    for (const lic of ["public domain", "CC0", "CC BY 4.0", "CC BY-SA 4.0"])
      assert.deepEqual(licenceFindings(claim({ source_url: URL_OK, license: lic, quote: words(500) })), [], lic);
  });
});

test("the licence must still be DECLARED — silence is not 'unknown'", () => {
  for (const license of [undefined, "", "   ", "free", "open access", "see website"]) {
    const got = licenceFindings(claim({ source_url: URL_OK, ...(license === undefined ? {} : { license }), quote: words(10) }));
    assert.equal(got.length, 1, JSON.stringify(license));
    assert.match(got[0], /licence must be declared/);
    assert.match(got[0], /Do not declare an open licence you have not seen/);
  }
});

test("plates (images) are untouched: an image cannot be quoted briefly", () => {
  const sub: any = claim({ source_url: URL_OK, license: "public domain", quote: "I x" });
  sub.waypoints[0].plates = [{ url: "https://gallica.bnf.fr/i.jpg", source_url: URL_OK, caption: "c", credit: "c",
                                license: "unknown", date: "1772" }];
  assert.ok(stage0(sub).some((f) => /plate1: licence not PD\/CC/.test(f)));
});

test("licenceUsable and isQuoteOnlyLicence never both say yes", () => {
  for (const lic of ["public domain", "CC0", "CC BY 4.0", "CC BY-SA 4.0", "CC BY-NC 4.0", "unknown", "", "all rights reserved"])
    assert.ok(!(licenceUsable(lic) && isQuoteOnlyLicence(lic)), lic);
});

test("an approved source is citable at Stage-0 through the injected registry, and only when it is a plain URL", () => {
  const dbnl = "https://www.dbnl.org/tekst/x01_01/";
  const sub = () => claim({ source_url: dbnl, license: "unknown", quote: words(10) });
  assert.ok(stage0(sub()).some((f) => /source domain not whitelisted/.test(f)), "precondition: not on the static list");
  const governed = (u: string) => new URL(u).hostname === "www.dbnl.org";
  assert.deepEqual(stage0(sub(), { governedHost: governed }).filter((f) => /whitelisted/.test(f)), []);
  // The predicate never sees a URL the static gate would refuse on shape.
  for (const bad of ["https://user:pw@www.dbnl.org/x", "https://www.dbnl.org:8443/x", "ftp://www.dbnl.org/x"]) {
    const s = claim({ source_url: bad, license: "unknown", quote: words(5) });
    assert.ok(stage0(s, { governedHost: () => true }).some((f) => /source domain not whitelisted/.test(f)), bad);
  }
  assert.equal(domainOk(dbnl), false, "the static list itself is unchanged");
});

test("the cap is one number: TypeScript and Python read the same file", () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, "..", "vocab", "controlled.json"), "utf8"));
  assert.equal(QUOTE_WORD_CAP, vocab.quote_only_word_cap);
  const py = execFileSync("python3", ["-c", "import sys; sys.path.insert(0,'ingest'); import licence; print(licence.QUOTE_WORD_CAP)"],
    { encoding: "utf8", cwd: join(__dirname, "..") });
  assert.equal(Number(py.trim()), QUOTE_WORD_CAP);
});
