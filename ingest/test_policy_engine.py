"""
Phase 3B.1: Deterministic Policy Activation Engine Tests (Hardened).
Tests pure function invariants for evaluating verified evidence without LLM/Network.

Run with:
    python3 -m unittest test_policy_engine -v
"""

import unittest
import datetime
from policy_engine import VerifiedEvidence, evaluate_source_policy

class TestDeterministicPolicyEngine(unittest.TestCase):

    def _base_evidence(self) -> VerifiedEvidence:
        return VerifiedEvidence(
            assessment_id=1,
            verified_at=datetime.datetime.now(datetime.timezone.utc),
            verifier_version="1.0",
            institution_identity_verified=True,
            endpoint_identity_verified=True,
            rights_statement_retrieved=True,
            rights_statement_hash_matches=True,
            rights_verified=True,
            rights_class="public_domain",
            rights_identifier="PD",
            rights_uri=None,
            scope_verified=True,
            scope_type="endpoint",
            scope_identifier="example.org",
            access_verified=True,
            verification_strategy="none",
            conflicts=[],
            evidence_sources=["https://example.org/terms"],
            policy_incompatible=False,
            incompatibility_codes=[]
        )

    def test_a_verified_endpoint_public_domain(self):
        # A. Verified endpoint-wide public domain => APPROVE / DOMAIN_TRUSTED
        evidence = self._base_evidence()
        result = evaluate_source_policy(evidence)
        
        self.assertEqual(result.decision_outcome, "approve")
        self.assertEqual(result.trust_mode, "domain_trusted")
        self.assertEqual(result.rule_id, "SG-P1-010_ENDPOINT_SCOPE_AND_RIGHTS_VERIFIED")

    def test_b_verified_collection_compatible_cc(self):
        # B. Verified collection-wide compatible CC licence => APPROVE / COLLECTION_TRUSTED
        evidence = self._base_evidence()
        evidence.rights_class = "creative_commons"
        evidence.scope_type = "collection"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "approve")
        self.assertEqual(result.trust_mode, "collection_trusted")
        self.assertEqual(result.rule_id, "SG-P1-011_COLLECTION_SCOPE_AND_RIGHTS_VERIFIED")

    def test_c_public_domain_unresolved_scope(self):
        # C. Public-domain wording but unresolved scope => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.scope_type = "unresolved"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertIn("SCOPE_UNRESOLVED", result.blocking_conditions)
        self.assertEqual(result.rule_id, "SG-P1-002_SCOPE_UNRESOLVED")

    def test_d_mixed_repository_supported_verifier(self):
        # D. Mixed repository + supported deterministic item verifier => APPROVE / ITEM_VERIFIED
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "archive_org_metadata"
        evidence.scope_type = "endpoint"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "approve")
        self.assertEqual(result.trust_mode, "item_verified")
        self.assertEqual(result.rule_id, "SG-P1-020_SUPPORTED_ITEM_VERIFIER")

    def test_e_mixed_repository_unsupported_verifier(self):
        # E. Mixed repository without supported item verifier => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "some_future_ai_verifier"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertIn("UNSUPPORTED_VERIFIER", result.blocking_conditions)
        self.assertEqual(result.rule_id, "SG-P1-021_MIXED_WITHOUT_SUPPORTED_VERIFIER")

    def test_f_legitimate_source_no_ingestion_link_only(self):
        # F. Verified legitimate source with no ingestion rights but link/reference allowed => APPROVE / LINK_ONLY
        evidence = self._base_evidence()
        evidence.rights_class = "in_copyright"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "approve")
        self.assertEqual(result.trust_mode, "link_only")
        self.assertEqual(result.rule_id, "SG-P1-030_LINK_ONLY_ALLOWED")

    def test_g_unknown_rights(self):
        # G. Unknown rights => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.rights_class = "unknown"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertIn("UNKNOWN_RIGHTS", result.blocking_conditions)

    def test_h_rights_unverified(self):
        # H. Rights statement exists but rights_verified=false => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.rights_verified = False
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertIn("RIGHTS_NOT_VERIFIED", result.blocking_conditions)

    def test_i_conflicting_rights(self):
        # I. Conflicting rights evidence => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.conflicts = ["Found CC-BY but terms also say 'all rights reserved'"]
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertIn("CONFLICTING_EVIDENCE", result.blocking_conditions)

    def test_j_scope_unverified(self):
        # J. scope_verified=false => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.scope_verified = False
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)
        self.assertEqual(result.rule_id, "SG-P1-002_SCOPE_UNRESOLVED")

    def test_k_hash_matches_but_rights_unverified(self):
        # K. Hash matches exactly but legal rights semantics are unverified => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.rights_statement_hash_matches = True
        evidence.rights_verified = False
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)

    def test_l_explicit_policy_incompatibility_reject(self):
        # L. Explicit verified policy incompatibility => REJECT (Driven by policy_incompatible fact)
        evidence = self._base_evidence()
        evidence.policy_incompatible = True
        evidence.incompatibility_codes = ["TERRAVELER_PROHIBITED_ARCHIVE"]
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "reject")
        self.assertIsNone(result.trust_mode)
        self.assertEqual(result.rule_id, "SG-P1-099_POLICY_INCOMPATIBLE")

    def test_m_unsupported_item_verifier(self):
        # M. Unsupported item verification strategy => NEEDS_HUMAN_REVIEW
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "non_existent"
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIn("UNSUPPORTED_VERIFIER", result.blocking_conditions)

    def test_n_reproducibility(self):
        # N. Same input + same policy version evaluated repeatedly => identical semantic PolicyEvaluation
        evidence = self._base_evidence()
        res1 = evaluate_source_policy(evidence)
        res2 = evaluate_source_policy(evidence)
        
        self.assertEqual(res1.decision_outcome, res2.decision_outcome)
        self.assertEqual(res1.trust_mode, res2.trust_mode)
        self.assertEqual(res1.rule_id, res2.rule_id)
        self.assertEqual(res1.evidence_snapshot, res2.evidence_snapshot)

    def test_o_archivist_confidence_change(self):
        # O. Changing only Archivist confidence/recommendation => MUST NOT change deterministic result
        self.assertFalse(hasattr(VerifiedEvidence, "llm_confidence"))
        self.assertFalse(hasattr(VerifiedEvidence, "recommended_trust_mode"))

    # -------------------------------------------------------------------------
    # Hardening & Regression Tests
    # -------------------------------------------------------------------------

    def test_item_verified_blocker_bypass_prevention_rights_unverified(self):
        # Mixed + archive_org_metadata + rights_verified=false => NEEDS_HUMAN_REVIEW (No bypass!)
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "archive_org_metadata"
        evidence.rights_verified = False
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)

    def test_item_verified_blocker_bypass_prevention_conflicts(self):
        # Mixed + archive_org_metadata + conflicts => NEEDS_HUMAN_REVIEW (No bypass!)
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "archive_org_metadata"
        evidence.conflicts = ["Terms say Public Domain but also Restricted"]
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)

    def test_item_verified_blocker_bypass_prevention_identity_unverified(self):
        # Mixed + archive_org_metadata + identity unverified => NEEDS_HUMAN_REVIEW (No bypass!)
        evidence = self._base_evidence()
        evidence.rights_class = "mixed"
        evidence.verification_strategy = "archive_org_metadata"
        evidence.endpoint_identity_verified = False
        
        result = evaluate_source_policy(evidence)
        self.assertEqual(result.decision_outcome, "needs_human_review")
        self.assertIsNone(result.trust_mode)

    def test_unsupported_policy_version_raises_error(self):
        evidence = self._base_evidence()
        with self.assertRaises(ValueError):
            evaluate_source_policy(evidence, policy_version="SOME_UNSUPPORTED_VERSION")

    def test_complete_evidence_snapshot(self):
        evidence = self._base_evidence()
        evidence.policy_incompatible = True
        evidence.incompatibility_codes = ["TEST"]
        result = evaluate_source_policy(evidence)
        
        snap = result.evidence_snapshot
        self.assertEqual(snap["assessment_id"], evidence.assessment_id)
        self.assertEqual(snap["verifier_version"], evidence.verifier_version)
        self.assertEqual(snap["policy_version"], "SG-P1")
        self.assertEqual(snap["rights_verified"], evidence.rights_verified)
        self.assertEqual(snap["scope_verified"], evidence.scope_verified)
        self.assertEqual(snap["access_verified"], evidence.access_verified)
        self.assertEqual(snap["policy_incompatible"], True)
        self.assertEqual(snap["incompatibility_codes"], ["TEST"])

    def test_canonicalize_evidence_and_hash_reproducibility(self):
        from policy_engine import canonicalize_evidence, compute_evidence_hash
        e1 = self._base_evidence()
        e2 = self._base_evidence()
        
        # Change dynamic metadata / timestamps on e2
        e2.assessment_id = 9999
        e2.verified_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
        e2.verifier_version = "2.0-beta"
        
        # Assert that the canonical string and resulting SHA256 hashes are 100% identical and reproducible
        self.assertEqual(canonicalize_evidence(e1), canonicalize_evidence(e2))
        self.assertEqual(compute_evidence_hash(e1), compute_evidence_hash(e2))

    def test_produce_verified_evidence_boundary(self):
        from policy_engine import produce_verified_evidence
        assessment = {
            "id": 42,
            "rights_class": "mixed",
            "rights_verified": True,
            "rights_scope_type": "endpoint",
            "rights_scope_identifier": "malicious-attacker.org",
            "access_verified": True,
            "verification_strategy": "prohibited",
            "conflicts": [],
            "evidence_sources": ["https://malicious-attacker.org/terms"]
        }
        
        evidence = produce_verified_evidence(assessment)
        self.assertEqual(evidence.assessment_id, 42)
        self.assertEqual(evidence.rights_class, "mixed")
        self.assertEqual(evidence.scope_type, "endpoint")
        self.assertEqual(evidence.scope_identifier, "malicious-attacker.org")
        self.assertTrue(evidence.policy_incompatible)
        self.assertIn("SG-INC-001_EXPLICIT_USE_PROHIBITION", evidence.incompatibility_codes)
        self.assertIn("SG-INC-003_INVALID_SOURCE_IDENTITY", evidence.incompatibility_codes)


if __name__ == "__main__":
    unittest.main()
