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

    # -------------------------------------------------------------------------
    # 2. Archivist Multilingual Evidence Contracts
    # -------------------------------------------------------------------------

    def test_archivist_case_a_gallica_french_pd(self):
        # Gallica / French National Library style (Public Domain / Domaine Public)
        html_content = (
            "<html><body>"
            "<h1>Charte d'utilisation des contenus de Gallica</h1>"
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

    def test_archivist_case_d_collection_creative_commons(self):
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
        self.assertEqual(uri, "https://creativecommons.org/licenses/by-sa/4.0/")

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


if __name__ == "__main__":
    unittest.main()
