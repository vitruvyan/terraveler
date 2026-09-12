import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  await t.test("Static Database Schema Verifications", () => {
    const sqlPath = join(__dirname, "../supabase/source_governance_schema.sql");
    const sql = readFileSync(sqlPath, "utf8");

    // 1. Assert ON DELETE RESTRICT on policy decisions (Audit retention mechanism)
    assert.match(
      sql,
      /endpoint_id\s+bigint\s+references\s+source_endpoints\(id\)\s+on\s+delete\s+restrict/i,
      "source_policy_decisions.endpoint_id MUST use ON DELETE RESTRICT"
    );
    assert.match(
      sql,
      /collection_id\s+bigint\s+references\s+source_collections\(id\)\s+on\s+delete\s+restrict/i,
      "source_policy_decisions.collection_id MUST use ON DELETE RESTRICT"
    );

    // 2. Assert that System proposals are removed (only 'human' and 'agent')
    assert.match(
      sql,
      /proposed_by_actor_type\s+text\s+not\s+null\s+check\s+\(proposed_by_actor_type\s+in\s+\('human',\s*'agent'\)\)/i,
      "source_proposals.proposed_by_actor_type must restrict only to 'human' and 'agent'"
    );

    // 3. Assert the System/Human decider and actor ID invariants on policy decisions
    assert.match(
      sql,
      /check\s*\(\s*\(decided_by_actor_type\s*=\s*'system'\s+and\s+decided_by_actor_id\s+is\s+null\)\s+or\s+\(decided_by_actor_type\s*=\s*'human'\s+and\s+decided_by_actor_id\s+is\s+not\s+null\)\s*\)/i,
      "source_policy_decisions MUST enforce that system actors have NULL IDs, and humans have NON-NULL IDs"
    );
  });
});
