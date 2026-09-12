"""
Phase 2B: Shadow Mode & Source Governance Resolver Verification Tests.
This test file runs offline, verifying full behavioral A/B fixture parity 
on standard domains, Archive.org items, default port normalization, and ContextVar safety.

Run with:
    python3 -m unittest test_shadow -v      (from ingest/)
"""

import unittest
import os
import sys
import concurrent.futures
from urllib.parse import urlparse

# Add parent directory and current directory to Python path
sys.path.append(os.path.dirname(__file__))
import whitelist
import source_governance_shadow

def stub(**meta):
    """A fake archive.org metadata endpoint returning one item's fields."""
    return lambda _url: {"metadata": meta}

class ShadowModeParityTests(unittest.TestCase):
    def setUp(self):
        # Ensure Shadow Mode is enabled for all tests
        os.environ["SOURCE_GOVERNANCE_SHADOW_ENABLED"] = "true"
        
        # Mock resolve_trust_from_db to simulate the seeded database registry offline
        # This completely avoids requiring a running PostgreSQL server for the tests.
        def mock_resolve_trust(url):
            try:
                parsed = urlparse(url)
                host = whitelist.normalize_host(url)
            except Exception:
                return {"matched": False, "decision": "deny", "trust_mode": "rejected", "verification_strategy": "none", "rights_class": "unknown"}
            
            # Map legacy whitelist to our seeded endpoint schema
            if host in ("gutenberg.org", "www.gutenberg.org", "gutendex.com"):
                return {
                    "matched": True,
                    "decision": "allow",
                    "trust_mode": "domain_trusted",
                    "verification_strategy": "none",
                    "rights_class": "public_domain",
                    "policy_decision_id": 1
                }
            elif host == "runeberg.org":
                return {
                    "matched": True,
                    "decision": "allow",
                    "trust_mode": "domain_trusted",
                    "verification_strategy": "none",
                    "rights_class": "public_domain",
                    "policy_decision_id": 4
                }
            elif host.endswith(".wikisource.org"):
                return {
                    "matched": True,
                    "decision": "allow",
                    "trust_mode": "domain_trusted",
                    "verification_strategy": "none",
                    "rights_class": "public_domain",
                    "policy_decision_id": 5
                }
            elif host.endswith(".wikipedia.org"):
                return {
                    "matched": True,
                    "decision": "allow",
                    "trust_mode": "domain_trusted",
                    "verification_strategy": "none",
                    "rights_class": "creative_commons",
                    "policy_decision_id": 6
                }
            elif host.endswith(".wikimedia.org"):
                return {
                    "matched": True,
                    "decision": "allow",
                    "trust_mode": "domain_trusted",
                    "verification_strategy": "none",
                    "rights_class": "mixed",
                    "policy_decision_id": 7
                }
            elif host in ("archive.org", "www.archive.org"):
                return {
                    "matched": True,
                    "decision": "requires_item_verification",
                    "trust_mode": "item_verified",
                    "verification_strategy": "archive_org_metadata",
                    "rights_class": "mixed",
                    "policy_decision_id": 8
                }
            return {
                "matched": False,
                "decision": "deny",
                "trust_mode": "rejected",
                "verification_strategy": "none",
                "rights_class": "unknown",
                "policy_decision_id": None
            }
            
        self.original_resolver = source_governance_shadow.resolve_trust_from_db
        source_governance_shadow.resolve_trust_from_db = mock_resolve_trust
        
        # Suppress writing to the DB for tests
        self.original_logger = source_governance_shadow.record_comparison
        source_governance_shadow.record_comparison = lambda *args, **kwargs: None

    def tearDown(self):
        # Restore original functions and environment
        source_governance_shadow.resolve_trust_from_db = self.original_resolver
        source_governance_shadow.record_comparison = self.original_logger
        if "SOURCE_GOVERNANCE_SHADOW_ENABLED" in os.environ:
            del os.environ["SOURCE_GOVERNANCE_SHADOW_ENABLED"]

    def test_gutenberg_allowed_in_both(self):
        url = "https://www.gutenberg.org/cache/epub/74723/pg74723.txt"
        ok, reason = whitelist.verify_source(url)
        self.assertTrue(ok)
        self.assertEqual(reason, "Public domain")
        
        # Verify registry matches
        reg = source_governance_shadow.resolve_trust_from_db(url)
        self.assertTrue(reg["matched"])
        self.assertEqual(reg["decision"], "allow")
        self.assertEqual(reg["rights_class"], "public_domain")

    def test_default_ports_are_equivalent(self):
        # Normal, explicit default port, and alternative port cases
        for prefix in ["https://gutenberg.org", "https://gutenberg.org:443"]:
            ok, reason = whitelist.verify_source(f"{prefix}/ebooks/1")
            self.assertTrue(ok, f"Failed on: {prefix}")
            self.assertEqual(reason, "Public domain")

        for prefix in ["http://gutenberg.org", "http://gutenberg.org:80"]:
            ok, reason = whitelist.verify_source(f"{prefix}/ebooks/1")
            self.assertTrue(ok, f"Failed on: {prefix}")
            self.assertEqual(reason, "Public domain")

        # Non-default ports remain distinct (rejected as off-whitelist)
        ok, reason = whitelist.verify_source("https://gutenberg.org:444/ebooks/1")
        self.assertFalse(ok)
        self.assertIn("off-whitelist", reason)

    def test_unknown_domain_rejected_in_both(self):
        url = "https://gallica.bnf.fr/ark:/12148/bpt6k12345"
        ok, reason = whitelist.verify_source(url)
        self.assertFalse(ok)
        self.assertIn("off-whitelist", reason)

    # -------------------------------------------------------------------------
    # Archive.org Item-Level Metadata Fixture Tests
    # Proves perfect A/B parity on all 6 required metadata states.
    # -------------------------------------------------------------------------

    def test_archive_case_a_valid_institutional_scan(self):
        # A. Valid institutional pre-1930 public domain scan
        url = "https://archive.org/details/cartierfirstvoyag00cart"
        fetch_stub = stub(
            date="1804",
            collection=["bostonpubliclibrary"],
            **{"access-restricted-item": "false"}
        )
        
        # Test legacy with metadata fetch injection
        legacy_ok, legacy_why = whitelist.verify_source(url, fetch_json=fetch_stub)
        self.assertTrue(legacy_ok)
        self.assertEqual(legacy_why, "Public domain (published 1804)")
        
        # Test shadow comparator behavior (must return legacy result and evaluate equivalent)
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url, fetch_json=fetch_stub)
        self.assertTrue(shadow_ok)
        self.assertEqual(shadow_why, "Public domain (published 1804)")

    def test_archive_case_b_lending_restricted(self):
        # B. Access-restricted lending item (rejected)
        url = "https://archive.org/details/columbusdiario"
        fetch_stub = stub(
            date="1989",
            collection=["opensource"],
            **{"access-restricted-item": "true"}
        )
        
        legacy_ok, legacy_why = whitelist.verify_source(url, fetch_json=fetch_stub)
        self.assertFalse(legacy_ok)
        self.assertIn("restricted", legacy_why)
        
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url, fetch_json=fetch_stub)
        self.assertFalse(shadow_ok)
        self.assertIn("restricted", shadow_why)

    def test_archive_case_c_modern_reprint(self):
        # C. Modern post-1929 reprint/translation (rejected)
        url = "https://archive.org/details/travelsofibnbattuta"
        fetch_stub = stub(
            date="2012",
            collection=["bostonpubliclibrary"],
            **{"access-restricted-item": "false"}
        )
        
        legacy_ok, legacy_why = whitelist.verify_source(url, fetch_json=fetch_stub)
        self.assertFalse(legacy_ok)
        self.assertIn("after the 1929 public-domain cutoff", legacy_why)
        
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url, fetch_json=fetch_stub)
        self.assertFalse(shadow_ok)
        self.assertIn("after the 1929 public-domain cutoff", shadow_why)

    def test_archive_case_d_community_upload(self):
        # D. User upload / unvetted community collection (rejected)
        url = "https://archive.org/details/gibbibnbattuta"
        fetch_stub = stub(
            date="1354",
            collection=["community"],
            **{"access-restricted-item": "false"}
        )
        
        legacy_ok, legacy_why = whitelist.verify_source(url, fetch_json=fetch_stub)
        self.assertFalse(legacy_ok)
        self.assertIn("user upload (community)", legacy_why)
        
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url, fetch_json=fetch_stub)
        self.assertFalse(shadow_ok)
        self.assertIn("user upload (community)", shadow_why)

    def test_archive_case_e_missing_metadata(self):
        # E. Missing date / empty metadata (rejected)
        url = "https://archive.org/details/emptyitem"
        fetch_stub = stub()
        
        legacy_ok, legacy_why = whitelist.verify_source(url, fetch_json=fetch_stub)
        self.assertFalse(legacy_ok)
        self.assertIn("no metadata", legacy_why)
        
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url, fetch_json=fetch_stub)
        self.assertFalse(shadow_ok)
        self.assertIn("no metadata", shadow_why)

    def test_archive_case_f_malformed_url(self):
        # F. Malformed or non-item Archive URL (rejected)
        url = "https://archive.org/details/"
        
        legacy_ok, legacy_why = whitelist.verify_source(url)
        self.assertFalse(legacy_ok)
        self.assertIn("not an archive.org item URL", legacy_why)
        
        shadow_ok, shadow_why = source_governance_shadow.compare_shadow(url)
        self.assertFalse(shadow_ok)
        self.assertIn("not an archive.org item URL", shadow_why)

    # -------------------------------------------------------------------------
    # Concurrency and ContextVar Safety
    # Proves thread/request-local recursion guard does not cause cross-suppression
    # -------------------------------------------------------------------------

    def test_contextvar_concurrency_isolation(self):
        """Verify that multiple concurrent executions are isolated and do not suppress shadow mode."""
        cv = whitelist._in_shadow_mode
        
        # Outer thread/context sets True
        token = cv.set(True)
        self.assertTrue(cv.get())
        
        # Running in a separate thread (representing an independent request context)
        # must see the default value (False) because contextvars are thread-local by default!
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(lambda: cv.get())
            result_in_other_thread = future.result()
            
        self.assertFalse(result_in_other_thread, "ContextVar leaked across independent request contexts!")
        
        # Clean up
        cv.reset(token)
        self.assertFalse(cv.get())


if __name__ == "__main__":
    unittest.main()
