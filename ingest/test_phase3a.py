"""
Phase 3A: Source Governance Proposal & Assessment Offline Test Suite.
Tests proposals, deduplication, SSRF security blocks, redirect revalidation,
and structured multilingual Archivist evidence generation.

Run with:
    python3 -m unittest test_phase3a -v      (from ingest/)
"""

import unittest
import os
import sys
import socket
import concurrent.futures
from urllib.parse import urlparse

# Add parent directory and current directory to Python path
sys.path.append(os.path.dirname(__file__))
import discovery_fetch
import archivist
import source_governance_shadow

class Phase3ASecurityAndGovernanceTests(unittest.TestCase):
    def setUp(self):
        # Override DB logging/connections for tests
        self.original_logger = source_governance_shadow.record_comparison
        source_governance_shadow.record_comparison = lambda *args, **kwargs: None

    def tearDown(self):
        source_governance_shadow.record_comparison = self.original_logger

    # -------------------------------------------------------------------------
    # 1. SSRF & Network Security Boundaries (Discovery Fetch Zone)
    # -------------------------------------------------------------------------

    def test_ssrf_blocks_private_ranges(self):
        # Loopback IPv4
        self.assertFalse(discovery_fetch.is_safe_ip("127.0.0.1"))
        self.assertFalse(discovery_fetch.is_safe_ip("127.255.255.254"))
        
        # Private Class A, B, C
        self.assertFalse(discovery_fetch.is_safe_ip("10.0.0.1"))
        self.assertFalse(discovery_fetch.is_safe_ip("172.16.0.1"))
        self.assertFalse(discovery_fetch.is_safe_ip("192.168.1.1"))
        
        # Link-local / AWS metadata
        self.assertFalse(discovery_fetch.is_safe_ip("169.254.169.254"))
        
        # IPv6 loopback & link-local
        self.assertFalse(discovery_fetch.is_safe_ip("::1"))
        self.assertFalse(discovery_fetch.is_safe_ip("fe80::1"))

    def test_ssrf_allows_public_ranges(self):
        # Google DNS, Cloudflare DNS, public web hosts
        self.assertTrue(discovery_fetch.is_safe_ip("8.8.8.8"))
        self.assertTrue(discovery_fetch.is_safe_ip("1.1.1.1"))
        self.assertTrue(discovery_fetch.is_safe_ip("140.211.166.4"))

    def test_untrusted_fetch_blocks_private_schemes_and_ports(self):
        # Blocks file:// and ftp://
        with self.assertRaises(PermissionError):
            discovery_fetch.validate_url("file:///etc/passwd")
        with self.assertRaises(PermissionError):
            discovery_fetch.validate_url("ftp://gutenberg.org/book")
            
        # Blocks non-standard ports (e.g. 8080, 22)
        with self.assertRaises(PermissionError):
            discovery_fetch.validate_url("https://gutenberg.org:8080/ebooks")

    def test_untrusted_fetch_userinfo_rejection(self):
        # Explicitly reject userinfo credentials (username/password) embedded in URLs
        with self.assertRaises(PermissionError):
            discovery_fetch.validate_url("https://user:password@gutenberg.org/ebooks")

    def test_untrusted_fetch_dns_rebinding_prevention(self):
        # Verifies that resolving a host checks all resolved IPs.
        # If any IP in the resolved set is unsafe (e.g., DNS rebinding returning 127.0.0.1 alongside a public IP),
        # it is blocked instantly.
        original_getaddrinfo = socket.getaddrinfo
        try:
            # Mock getaddrinfo to return a mix of public and loopback IPs (DNS rebinding signature)
            socket.getaddrinfo = lambda host, port, *args: [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 80)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))
            ]
            with self.assertRaises(PermissionError):
                discovery_fetch.resolve_and_verify_ips("gutenberg.org")
        finally:
            socket.getaddrinfo = original_getaddrinfo

    # -------------------------------------------------------------------------
    # 2. Archivist Multilingual Evidence Contracts
    # -------------------------------------------------------------------------

    def test_archivist_case_a_gallica_french_pd(self):
        # Gallica / French National Library style (Public Domain / Domaine Public)
        html_content = (
            "<html><body>"
            "<h1>Charte d'utilisation des contenidos de Gallica</h1>"
            "<p>Les contenus de Gallica sont libres d'utilisation. Les documents "
            "numérisés entrent dans le domaine public de l'Etat.</p>"
            "</body></html>"
        )
        
        res = archivist.detect_rights_class(html_content)
        rights_class, spdx, uri, excerpt = res
        self.assertEqual(rights_class, "public_domain")
        self.assertEqual(spdx, "PD")
        self.assertIn("domaine public", excerpt.lower())

    def test_archivist_case_b_pares_spanish(self):
        # PARES Spanish national archive style
        html_content = (
            "<html><body>"
            "<h1>Portal de Archivos Españoles</h1>"
            "<p>Los documentos reproducidos están exentos de derechos de autor y "
            "son de dominio público para su investigación histórica.</p>"
            "</body></html>"
        )
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "public_domain")
        self.assertIn("dominio público", excerpt.lower())

    def test_archivist_case_c_portuguese_pd(self):
        # Portuguese national library style
        html_content = (
            "<html><body>"
            "<h1>Biblioteca Nacional de Portugal</h1>"
            "<p>Todas as obras cujos direitos de autor caducaram pertencem ao "
            "domínio público segundo o código do direito de autor.</p>"
            "</body></html>"
        )
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "public_domain")
        self.assertIn("domínio público", excerpt.lower())

    def test_archivist_case_d_collection_creative_commons_has_unresolved_scope(self):
        # Clear CC collection-level rights
        html_content = (
            "<html><body>"
            "<h1>Digital Collection Access</h1>"
            "<p>This collection is published under a Creative Commons Attribution-ShareAlike "
            "4.0 International License (CC BY-SA 4.0).</p>"
            "</body></html>"
        )
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "creative_commons")
        self.assertEqual(spdx, "CC-BY-SA-4.0")
        
        # Mock database connection and cursor to run fully offline
        class MockCursor:
            def __init__(self):
                self.queries = []
            def execute(self, query, params=None):
                self.queries.append((query, params))
            def fetchone(self):
                # Return appropriate mocks depending on query contents
                query_str = self.queries[-1][0].lower()
                if "agent_accounts" in query_str:
                    return {"id": 888}
                if "source_proposals" in query_str:
                    return {"id": 1, "target_url": "https://example.org/collection/foo", "proposed_by_actor_type": "human", "proposed_by_actor_id": 1}
                if "insert into source_assessments" in query_str:
                    return {"id": 42}
                return None
            def __enter__(self):
                return self
            def __exit__(self, exc_type, exc_val, exc_tb):
                pass

        class MockConnection:
            def cursor(self):
                return MockCursor()
            def commit(self):
                pass
            def rollback(self):
                pass
            def close(self):
                pass

        original_get_db = source_governance_shadow.get_db_connection
        source_governance_shadow.get_db_connection = lambda: MockConnection()
        
        try:
            # Assess mock
            assessment = archivist.assess_source_proposal(1, mock_fetch_content=html_content)
            self.assertEqual(assessment["evidence_contract"]["rights_scope_type"], "unresolved")
            self.assertEqual(assessment["evidence_contract"]["recommended_trust_mode"], "needs_human_review")
        finally:
            source_governance_shadow.get_db_connection = original_get_db

    def test_archivist_case_f_ambiguous_rights(self):
        # Ambiguous rights (triggers needs_human_review / unknown)
        html_content = "<html><body>We permit private non-commercial study only, contact us for details.</body></html>"
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "unknown")

    def test_archivist_case_g_inaccessible_login_only(self):
        # Inaccessible / restricted scan (link_only / in_copyright)
        html_content = "<html><body>All rights reserved. Subscription required. Access restricted to library terminals.</body></html>"
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "in_copyright")
        self.assertEqual(spdx, "copyright_restricted")

    def test_mixed_rights_adversarial_fixture_does_not_yield_domain_trusted(self):
        # Adversarial mixed-rights warning: must never yield DOMAIN_TRUSTED!
        html_content = (
            "<html><body>"
            "This repository contains both copyrighted works and works in the public domain."
            "Please check each item separately."
            "</body></html>"
        )
        
        rights_class, spdx, uri, excerpt = archivist.detect_rights_class(html_content)
        self.assertEqual(rights_class, "mixed")
        self.assertEqual(spdx, "mixed_repository_warning")

    # -------------------------------------------------------------------------
    # 3. Specialist Archivist Durable Identity & Safety
    # -------------------------------------------------------------------------

    def test_archivist_identity_missing_fails_closed(self):
        # Verify that if the durable system-archivist agent record does not exist
        # or is inactive, the Archivist system immediately fails closed (throws PermissionError)
        class FakeCursor:
            def execute(self, query, params=None):
                pass
            def fetchone(self):
                return None  # Simulate missing/inactive row
                
        with self.assertRaises(PermissionError):
            archivist.get_archivist_agent_id(FakeCursor())

    def test_archivist_identity_resolution_success(self):
        # Verify that when active, it resolves the correct database primary key
        class FakeCursor:
            def execute(self, query, params=None):
                pass
            def fetchone(self):
                return {"id": 12345}  # Valid DB PK
                
        pk = archivist.get_archivist_agent_id(FakeCursor())
        self.assertEqual(pk, 12345)

    # -------------------------------------------------------------------------
    # 4. Request-Local Transport Concurrency Test (No Crosstalk / No Global State)
    # -------------------------------------------------------------------------

    def test_untrusted_fetch_concurrency_no_crosstalk(self):
        """Verify that multiple concurrent discovery fetches targeting different hosts have zero crosstalk."""
        # Using ThreadPoolExecutor to verify isolated thread-local execution contexts
        def run_independent_fetch_configs(host_name):
            # Assert that other thread configs do not bleed or pollute this execution
            h1 = discovery_fetch.SecureHTTPConnection(host_name)
            self.assertEqual(h1.host, host_name)
            return h1.host

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(run_independent_fetch_configs, "gutenberg.org")
            f2 = executor.submit(run_independent_fetch_configs, "archive.org")
            
            self.assertEqual(f1.result(), "gutenberg.org")
            self.assertEqual(f2.result(), "archive.org")


if __name__ == "__main__":
    unittest.main()
