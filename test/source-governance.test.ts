import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { 
  resolveTrust, 
  SEED_ENDPOINTS, 
  SEED_DECISIONS, 
  type SourceEndpoint, 
  type SourceCollection, 
  type SourcePolicyDecision, 
  type EvidenceSnapshot 
} from "../lib/source-governance";

function runLegacyVerifier(url: string): { allowed: boolean; why: string } {
  // Use _IN_SHADOW_MODE to avoid loop during validation test
  const pythonCmd = `python3 -c "import sys, os; sys.path.append('ingest'); os.environ['_IN_SHADOW_MODE'] = 'true'; import whitelist; ok, why = whitelist.verify_source('${url}'); print(f'{ok}|{why}')"`;
  try {
    const stdout = execSync(pythonCmd, { encoding: "utf8" });
    const [ok, why] = stdout.trim().split("|");
    return {
      allowed: ok === "True",
      why: why || ""
    };
  } catch (e: any) {
    return {
      allowed: false,
      why: e.message
    };
  }
}

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

    // 4. Assert Immutability Triggers for decisions, assessments, and reverifications
    const immutabilitySqlPath = join(__dirname, "../supabase/source_governance_immutability.sql");
    const immutabilitySql = readFileSync(immutabilitySqlPath, "utf8");
    assert.match(
      immutabilitySql,
      /before\s+update\s+or\s+delete\s+on\s+source_policy_decisions/i,
      "source_policy_decisions MUST trigger append-only checks before update or delete"
    );
    assert.match(
      immutabilitySql,
      /before\s+update\s+or\s+delete\s+on\s+source_assessments/i,
      "source_assessments MUST trigger append-only checks before update or delete"
    );
    assert.match(
      immutabilitySql,
      /before\s+update\s+or\s+delete\s+on\s+source_reverifications/i,
      "source_reverifications MUST trigger append-only checks before update or delete"
    );

    // 5. Assert 'unresolved' scope CHECK constraint in source_assessments
    assert.match(
      sql,
      /rights_scope_type\s+text\s+not\s+null\s+check\s+\(rights_scope_type\s+in\s+\('endpoint',\s*'collection',\s*'item',\s*'unresolved'\)\)/i,
      "source_assessments.rights_scope_type check constraint MUST permit 'unresolved'"
    );

    // 6. Assert source_proposal_intents table exists
    assert.match(
      sql,
      /create\s+table\s+if\s+not\s+exists\s+source_proposal_intents/i,
      "source_proposal_intents table MUST be defined"
    );

    // 7. Assert atomic mcp_propose_source SQL function exists
    const rpcSqlPath = join(__dirname, "../supabase/mcp_propose_source.sql");
    const rpcSql = readFileSync(rpcSqlPath, "utf8");
    assert.match(
      rpcSql,
      /create\s+or\s+replace\s+function\s+mcp_propose_source/i,
      "mcp_propose_source SQL function MUST be defined"
    );

    // 8. Assert apply_source_policy_decision uses exactly: set search_path = pg_catalog, public
    const applyRpcSqlPath = join(__dirname, "../supabase/apply_source_policy_decision.sql");
    const applyRpcSql = readFileSync(applyRpcSqlPath, "utf8");
    assert.match(
      applyRpcSql,
      /set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
      "apply_source_policy_decision MUST set search_path exactly to 'pg_catalog, public'"
    );

    // 9. Assert fresh schema boots and grants terraveler_evaluator role
    assert.match(
      sql,
      /create\s+role\s+terraveler_evaluator/i,
      "source_governance_schema.sql MUST declare terraveler_evaluator role bootstrap"
    );

    // 10. Assert migration explicitly revokes generic insert/update/delete/truncate from evaluations and append-only tables
    const migrationSqlPath = join(__dirname, "../supabase/source_governance_phase_3b_2_migration.sql");
    const migrationSql = readFileSync(migrationSqlPath, "utf8");
    assert.match(
      migrationSql,
      /revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s+on\s+source_policy_evaluations\s+from\s+terraveler_service/i,
      "migration MUST explicitly revoke insert/update/delete/truncate on evaluations from terraveler_service"
    );
    assert.match(
      migrationSql,
      /revoke\s+update\s*,\s*delete\s*,\s*truncate\s+on\s+source_verified_evidence\s+from\s+terraveler_service/i,
      "migration MUST explicitly revoke update/delete/truncate on evidence from terraveler_service"
    );
    assert.match(
      migrationSql,
      /revoke\s+update\s*,\s*delete\s*,\s*truncate\s+on\s+source_verified_evidence\s*,\s*source_policy_evaluations\s+from\s+terraveler_evaluator/i,
      "migration MUST explicitly revoke update/delete/truncate on evaluations and evidence from terraveler_evaluator"
    );

    // 11. Assert 3B.3 migration preserves legacy source_reverifications data and has NO DROP TABLE CASCADE
    const migration3b3SqlPath = join(__dirname, "../supabase/source_governance_phase_3b_3_migration.sql");
    const migration3b3Sql = readFileSync(migration3b3SqlPath, "utf8");
    assert.equal(
      /drop\s+table\s+source_reverifications/i.test(migration3b3Sql),
      false,
      "Phase 3B.3 migration MUST NOT drop source_reverifications table"
    );
  });

  await t.test("mcp_resolve_source_proposal refuses multi-intent and collection-based proposals, and both SECURITY DEFINER functions set search_path", () => {
    const resolveSql = readFileSync(join(__dirname, "../supabase/mcp_resolve_source_proposal.sql"), "utf8");

    // S9: SECURITY DEFINER without search_path, same class of gap
    // apply_source_policy_decision and quarantine_source_subject already close.
    assert.match(
      resolveSql,
      /security\s+definer\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
      "mcp_resolve_source_proposal MUST set search_path exactly to 'pg_catalog, public'"
    );

    // S1a: more than one source_proposal_intents row must block resolution
    // outright -- for approve AND reject alike -- not resolve silently.
    assert.match(
      resolveSql,
      /select\s+count\(\*\)\s+into\s+v_intent_count\s+from\s+source_proposal_intents\s+where\s+proposal_id\s*=\s*p_proposal_id/i,
      "mcp_resolve_source_proposal MUST count this proposal's source_proposal_intents rows"
    );
    assert.match(
      resolveSql,
      /if\s+v_intent_count\s*>\s*1\s+then\s+return\s+jsonb_build_object\('error'/i,
      "mcp_resolve_source_proposal MUST return an error (not proceed) when a proposal has more than one intent"
    );
    // The count check must sit before the approve/reject branch splits, so
    // it guards both outcomes rather than just one.
    const intentGuardAt = resolveSql.search(/if\s+v_intent_count\s*>\s*1/i);
    const branchAt = resolveSql.search(/if\s+p_decision\s*=\s*'approve'\s+then/i);
    assert.ok(intentGuardAt >= 0 && branchAt >= 0 && intentGuardAt < branchAt,
      "the multi-intent guard MUST run before the approve/reject branch, so it blocks both");

    // S4: collection_id was read via `select *` but never checked -- a
    // collection-targeted proposal must not fall into the endpoint branch.
    assert.match(
      resolveSql,
      /if\s+v_proposal\.collection_id\s+is\s+not\s+null\s+then\s+return\s+jsonb_build_object\('error'/i,
      "mcp_resolve_source_proposal MUST reject proposals with a non-null collection_id instead of falling through to the endpoint branch"
    );
    const collectionGuardAt = resolveSql.search(/if\s+v_proposal\.collection_id\s+is\s+not\s+null/i);
    assert.ok(collectionGuardAt >= 0 && collectionGuardAt < branchAt,
      "the collection_id guard MUST also run before the approve/reject branch");

    // S10: status='resolved' could not distinguish approved from rejected.
    // Now the function writes the two outcomes as distinct terminal values
    // instead of the old, ambiguous generic one.
    assert.match(
      resolveSql,
      /update\s+source_proposals\s+set\s+status\s*=\s*'approved'/i,
      "the approve branch MUST write status = 'approved'"
    );
    assert.match(
      resolveSql,
      /update\s+source_proposals\s+set\s+status\s*=\s*'rejected'/i,
      "the reject branch MUST write status = 'rejected'"
    );
    assert.equal(
      /update\s+source_proposals\s+set\s+status\s*=\s*'resolved'/i.test(resolveSql),
      false,
      "no branch should still write the old ambiguous status = 'resolved'"
    );

    const proposeSql = readFileSync(join(__dirname, "../supabase/mcp_propose_source_classification.sql"), "utf8");
    assert.match(
      proposeSql,
      /security\s+definer\s+set\s+search_path\s*=\s*pg_catalog\s*,\s*public/i,
      "mcp_propose_source MUST set search_path exactly to 'pg_catalog, public'"
    );
    // The dedup lookup used to read `status != 'resolved'`, which would
    // treat every newly 'approved'/'rejected' proposal as still open once
    // those became real values instead of the historical-only 'resolved'.
    // It must key off the one status that has ever meant "still open."
    assert.match(
      proposeSql,
      /where\s+status\s*=\s*'submitted'\s+and\s*\(/i,
      "mcp_propose_source's dedup lookup MUST treat 'submitted' as the only open status, not '!= resolved'"
    );
    assert.equal(
      /where\s+status\s*!=\s*'resolved'/i.test(proposeSql),
      false,
      "mcp_propose_source MUST NOT still key its open-proposal dedup off '!= resolved'"
    );

    // The additive CHECK constraint: 'resolved' stays valid for the 9
    // historical rows, no backfill, alongside the two new terminal values.
    const constraintSql = readFileSync(join(__dirname, "../supabase/source_proposal_resolution_authority.sql"), "utf8");
    assert.match(
      constraintSql,
      /check\s*\(status\s+in\s*\('submitted',\s*'resolved',\s*'approved',\s*'rejected'\)\)/i,
      "source_proposals.status CHECK constraint MUST permit 'submitted', 'resolved' (historical), 'approved', and 'rejected'"
    );
    assert.equal(
      /drop\s+/i.test(constraintSql),
      false,
      "the resolution-authority migration MUST be additive -- no DROP"
    );
  });

  await t.test("Seed equivalence and Archivist dynamic provisioning verification", () => {
    const seedPath = join(__dirname, "../supabase/source_governance_seed.sql");
    const seedSql = readFileSync(seedPath, "utf8");

    // Check that every seeded endpoint pattern is present in the SQL file
    for (const e of SEED_ENDPOINTS) {
      assert.ok(
        seedSql.includes(e.host_pattern),
        `SQL seed file does not contain endpoint host pattern: ${e.host_pattern}`
      );
    }

    // Assert that the seed SQL doesn't hardcode any physical PKs like 888 for the Archivist,
    // allowing the database to allocate them dynamically and securely.
    assert.equal(
      /id\s*=\s*888/i.test(seedSql),
      false,
      "The seed SQL MUST NOT contain hardcoded numeric 888 PK assignments for the Archivist"
    );
    assert.equal(
      /888/i.test(seedSql),
      false,
      "The seed SQL MUST NOT contain any fixed/hardcoded numeric PKs for the Archivist"
    );
  });

  await t.test("public source proposals tool does not leak internal database PKs", () => {
    const mcpRoutePath = join(__dirname, "../app/api/mcp/route.ts");
    const mcpRoute = readFileSync(mcpRoutePath, "utf8");
    
    // Assert that we map or explicitly strip proposed_by_actor_id from list_source_proposals
    assert.match(
      mcpRoute,
      /case\s+"list_source_proposals":\s*\{[\s\S]*?select=id,target_url,proposed_by_actor_type,status/i,
      "list_source_proposals MUST NOT select or return proposed_by_actor_id"
    );
    assert.match(
      mcpRoute,
      /case\s+"get_source_proposal":\s*\{[\s\S]*?select=id,target_url,proposed_by_actor_type,status/i,
      "get_source_proposal MUST NOT select or return proposed_by_actor_id"
    );
  });

  await t.test("Shadow Mode A/B Fixture Parity", () => {
    const testURLs = [
      // 1. Gutenberg / Runeberg
      "https://gutenberg.org/ebooks/123",
      "https://www.gutenberg.org/cache/epub/74723/pg74723.txt",
      "https://gutendex.com/books/1",
      "https://runeberg.org/nordisk/",
      
      // 2. Wikisource / Wikipedia Multilingual
      "https://en.wikisource.org/wiki/Main_Page",
      "https://fr.wikisource.org/wiki/Page_principale",
      "https://es.wikisource.org/wiki/Portada",
      "https://pt.wikisource.org/wiki/P%C3%A1gina_principal",
      "https://nl.wikisource.org/wiki/Hoofdpagina",
      "https://de.wikisource.org/wiki/Hauptseite",
      "https://it.wikisource.org/wiki/Pagina_principale",
      "https://zh.wikisource.org/wiki/Main_Page",
      "https://ja.wikisource.org/wiki/%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8",
      "https://ru.wikisource.org/wiki/%E0%B0%B5",
      "https://la.wikisource.org/wiki/Pagina_prima",
      "https://ja.wikipedia.org/wiki/X",
      "https://en.wikipedia.org/wiki/Y",
      "https://upload.wikimedia.org/wikipedia/commons/6/62/P.jpg",

      // 3. Archive.org item checks
      "https://archive.org/details/travelsofibnbatu0000unse",
      "https://www.archive.org/details/cook-journal",

      // 4. Host attacks
      "https://wikisource.org.attacker.example/x",
      "https://wikipedia.org.evil.example/y",
      "https://evil-wikimedia.org/z",
      "https://archive.org.attacker.example/w",
      "https://WWW.GutenBerg.org/ebooks/1", // casing
      "https://gutenberg.org:443/ebooks/1", // port

      // 5. Unknown legitimate archives (Must be rejected in both)
      "https://gallica.bnf.fr/ark:/12148/bpt6k12345",
      "https://arquivos.rtp.pt/conteudos/123",
      "https://pares.mcu.es/ParesBusquedas20/catalogo/show/123"
    ];

    for (const url of testURLs) {
      // Resolve using JS resolver
      const reg = resolveTrust(url);
      
      // Resolve using Python verifier via compare_shadow
      const legacyResult = runLegacyVerifier(url);
      
      if (url.includes("archive.org")) {
        // Semantic alignment check for mixed repositories
        assert.ok(reg ? reg.endpoint.trust_mode === "item_verified" : !legacyResult.allowed);
      } else {
        const allowedInReg = reg ? reg.endpoint.trust_mode === "domain_trusted" : false;
        assert.equal(
          allowedInReg,
          legacyResult.allowed,
          `Mismatched allowance for URL: ${url}. Reg: ${allowedInReg}, Legacy: ${legacyResult.allowed}`
        );
      }
    }
  });
});
