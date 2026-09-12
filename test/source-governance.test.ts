import { test } from "node:test";
import assert from "node:assert/strict";
import { 
  resolveTrust, 
  SEED_ENDPOINTS, 
  SEED_DECISIONS, 
  type SourceEndpoint, 
  type SourceCollection, 
  type SourcePolicyDecision, 
  type EvidenceSnapshot 
} from "../lib/source-governance";

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

  await t.test("exact legacy wikimedia representation (no item verifier, domain_trusted)", () => {
    const res = resolveTrust("https://upload.wikimedia.org/wikipedia/commons/x.jpg");
    assert.ok(res);
    assert.equal(res.endpoint.trust_mode, "domain_trusted");
    assert.equal(res.decision?.rights_class, "mixed");
    assert.equal(res.decision?.rights_identifier, "per-file (PD/CC, verified)");
    assert.equal(res.rule?.verification_strategy, "none"); // Matches legacy behavior
  });

  await t.test("trust_mode decoupled from lifecycle status (no pending/rejected in TrustMode)", () => {
    const unapprovedEndpoint: SourceEndpoint = {
      id: 99,
      institution_id: 1,
      host_pattern: "unapproved.example.org",
      match_type: "exact",
      status: "triaging", // Lifecycle status
      trust_mode: null // Not trusted yet
    };

    assert.equal(unapprovedEndpoint.trust_mode, null);
    assert.equal(unapprovedEndpoint.status, "triaging");
  });

  await t.test("collection lifecycle and trust constraints", () => {
    const collection: SourceCollection = {
      id: 1,
      endpoint_id: 1,
      name: "Fonds de la Marine",
      path_prefix: "/marine",
      status: "active",
      trust_mode: "collection_trusted"
    };

    assert.equal(collection.status, "active");
    assert.equal(collection.trust_mode, "collection_trusted");
  });

  await t.test("evidence snapshot is strongly typed", () => {
    const snapshot: EvidenceSnapshot = {
      rights_scope_type: "endpoint",
      rights_class: "public_domain",
      rights_statement_hash: "abcd1234hash",
      rights_statement_url: "https://gutenberg.org/license"
    };

    const decision: SourcePolicyDecision = {
      id: 42,
      endpoint_id: 1,
      trust_mode: "domain_trusted",
      rights_class: "public_domain",
      evidence_snapshot: snapshot,
      carta_version: "0.7",
      decided_by_actor_type: "system",
      decided_by_actor_id: null,
      reason: "Verifiable proof"
    };

    assert.equal(decision.evidence_snapshot.rights_scope_type, "endpoint");
    assert.equal(decision.evidence_snapshot.rights_statement_hash, "abcd1234hash");
  });

  await t.test("audit retention model: policy decisions persist independently", () => {
    // Tests that policy decisions don't cascade delete at the domain level
    const decision: SourcePolicyDecision = {
      id: 100,
      endpoint_id: null, // Nullable to survive endpoint deletion (set null)
      collection_id: null,
      trust_mode: "domain_trusted",
      rights_class: "public_domain",
      evidence_snapshot: {
        rights_scope_type: "endpoint",
        rights_class: "public_domain",
        rights_statement_hash: "hash"
      },
      carta_version: "0.7",
      decided_by_actor_type: "system",
      decided_by_actor_id: null,
      reason: "Retained history after endpoint removal"
    };

    assert.equal(decision.endpoint_id, null);
    assert.equal(decision.trust_mode, "domain_trusted");
  });
});
