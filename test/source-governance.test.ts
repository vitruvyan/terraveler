import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTrust } from "../lib/source-governance";

test("Source Governance Domain Model", async (t) => {
  await t.test("exact host match outranks suffix", () => {
    const res = resolveTrust("https://www.gutenberg.org/cache/epub/74723/pg74723.txt");
    assert.ok(res);
    assert.equal(res.endpoint.trust_mode, "domain_trusted");
    assert.equal(res.decision?.rights_class, "public_domain");
  });

  await t.test("wikisource is admitted via suffix in any language", () => {
    for (const lang of ["de", "it", "pt", "es", "zh", "ja", "ru", "nl", "la"]) {
      const res = resolveTrust(`https://${lang}.wikisource.org/wiki/Anything`);
      assert.ok(res, `${lang}.wikisource.org refused`);
      assert.equal(res.endpoint.trust_mode, "domain_trusted", `${lang} failed`);
      assert.equal(res.decision?.rights_class, "public_domain");
    }
  });

  await t.test("wikipedia follows suffix rule for CC BY-SA 4.0", () => {
    const res = resolveTrust("https://ja.wikipedia.org/wiki/X");
    assert.ok(res);
    assert.equal(res.endpoint.trust_mode, "domain_trusted");
    assert.equal(res.decision?.rights_class, "creative_commons");
    assert.equal(res.decision?.rights_identifier, "CC-BY-SA-4.0");
  });

  await t.test("archive.org triggers item_verified access rule", () => {
    const res = resolveTrust("https://archive.org/details/travelsofibnbatu0000unse");
    assert.ok(res);
    assert.equal(res.endpoint.trust_mode, "item_verified");
    assert.equal(res.rule?.verification_strategy, "archive_org_metadata");
  });

  await t.test("suffix rule is not a substring rule", () => {
    assert.equal(resolveTrust("https://wikisource.org.attacker.example/x"), null);
    assert.equal(resolveTrust("https://notwikisource.org/x"), null);
  });
  
  await t.test("off-whitelist domain is rejected", () => {
    assert.equal(resolveTrust("https://example.com/book.txt"), null);
  });
});
